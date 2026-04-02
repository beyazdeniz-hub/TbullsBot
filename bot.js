const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const LIST_URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTelegramPhoto(filePath, caption = "") {
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("caption", caption);
  form.append("photo", fs.createReadStream(filePath));

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });
}

async function sendTelegramMessage(text) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
  });
}

async function closePopups(page) {
  const texts = [
    "Kabul",
    "Accept",
    "Tamam",
    "Anladım",
    "Got it",
    "Close",
    "Kapat",
    "I Agree",
    "Allow",
    "Onayla"
  ];

  try {
    const buttons = await page.$$("button, a, div[role='button'], span[role='button']");
    for (const btn of buttons) {
      try {
        const txt = await page.evaluate((el) => (el.innerText || el.textContent || "").trim(), btn);
        if (texts.some((t) => txt.toLowerCase().includes(t.toLowerCase()))) {
          await btn.click().catch(() => {});
          await sleep(500);
        }
      } catch {}
    }
  } catch {}
}

async function autoScrollToBottom(page) {
  let lastHeight = 0;
  let stableCount = 0;

  for (let i = 0; i < 50; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 1.6);
    });

    await sleep(1300);

    const info = await page.evaluate(() => ({
      scrollY: window.scrollY,
      innerHeight: window.innerHeight,
      bodyHeight: Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      ),
    }));

    if (info.bodyHeight === lastHeight) {
      stableCount++;
    } else {
      stableCount = 0;
      lastHeight = info.bodyHeight;
    }

    if (stableCount >= 5) break;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1200);
}

async function getFirstTicker(page) {
  return await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll("a[href*='SignalPage.aspx?lang=tr&Ticker=']")
    );

    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const match = href.match(/Ticker=([^&]+)/i);
      if (match && match[1]) {
        return match[1].trim().toUpperCase();
      }
    }
    return null;
  });
}

async function waitForChartContent(page) {
  for (let i = 0; i < 15; i++) {
    const info = await page.evaluate(() => {
      const svgs = document.querySelectorAll("svg").length;
      const canvases = document.querySelectorAll("canvas").length;
      const imgs = document.querySelectorAll("img").length;
      return { svgs, canvases, imgs };
    });

    if (info.svgs > 0 || info.canvases > 0 || info.imgs > 0) {
      return true;
    }

    await sleep(1000);
  }

  return false;
}

async function findBestChartClip(page) {
  const result = await page.evaluate(() => {
    function rectObj(el) {
      const r = el.getBoundingClientRect();
      return {
        x: r.left + window.scrollX,
        y: r.top + window.scrollY,
        width: r.width,
        height: r.height,
      };
    }

    function visibleEnough(r) {
      return r.width >= 250 && r.height >= 120;
    }

    function scoreRect(r) {
      let score = 0;
      score += Math.min(r.width, 1200);
      score += Math.min(r.height * 2, 1000);

      if (r.width >= 600) score += 400;
      if (r.height >= 250) score += 300;

      return score;
    }

    const candidates = [];

    // 1) En güçlü aday: Mozilla'da gördüğün rect benzeri alan
    const rects = Array.from(document.querySelectorAll("svg rect"));
    for (const rect of rects) {
      const w = Number(rect.getAttribute("width") || 0);
      const h = Number(rect.getAttribute("height") || 0);
      const fill = (rect.getAttribute("fill") || "").toLowerCase();
      const opacity = Number(rect.getAttribute("opacity") || 1);

      const looksLikeChartHitbox =
        (w >= 600 && h >= 250) ||
        (w === 647 && h === 296) ||
        (fill.includes("gray") && opacity <= 0.05 && w >= 500 && h >= 200);

      if (!looksLikeChartHitbox) continue;

      const svg = rect.closest("svg");
      if (!svg) continue;

      const r = rectObj(svg);
      if (!visibleEnough(r)) continue;

      candidates.push({
        type: "svg-rect-parent",
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        score: scoreRect(r) + 2000,
      });
    }

    // 2) Büyük SVG alanları
    const svgs = Array.from(document.querySelectorAll("svg"));
    for (const svg of svgs) {
      const r = rectObj(svg);
      if (!visibleEnough(r)) continue;

      candidates.push({
        type: "svg",
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        score: scoreRect(r) + 1000,
      });
    }

    // 3) Canvas alanları
    const canvases = Array.from(document.querySelectorAll("canvas"));
    for (const canvas of canvases) {
      const r = rectObj(canvas);
      if (!visibleEnough(r)) continue;

      candidates.push({
        type: "canvas",
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        score: scoreRect(r) + 800,
      });
    }

    // 4) Büyük resimler
    const imgs = Array.from(document.querySelectorAll("img"));
    for (const img of imgs) {
      const r = rectObj(img);
      if (!visibleEnough(r)) continue;

      candidates.push({
        type: "img",
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        score: scoreRect(r) + 500,
      });
    }

    // 5) Genel büyük bloklar
    const blocks = Array.from(document.querySelectorAll("div, section, article, td"));
    for (const el of blocks) {
      const r = rectObj(el);
      if (r.width < 600 || r.height < 220) continue;

      const text = (el.innerText || "").toLowerCase();
      const html = (el.innerHTML || "").toLowerCase();

      let bonus = 0;
      if (text.includes("grafik")) bonus += 300;
      if (text.includes("chart")) bonus += 300;
      if (html.includes("<svg")) bonus += 500;
      if (html.includes("<canvas")) bonus += 500;

      if (bonus <= 0) continue;

      candidates.push({
        type: "block",
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        score: scoreRect(r) + bonus,
      });
    }

    if (!candidates.length) {
      return {
        found: false,
        debug: {
          svgCount: document.querySelectorAll("svg").length,
          canvasCount: document.querySelectorAll("canvas").length,
          imgCount: document.querySelectorAll("img").length,
        },
      };
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    const paddingX = 20;
    const paddingY = 20;

    const finalRect = {
      x: Math.max(0, Math.round(best.x - paddingX)),
      y: Math.max(0, Math.round(best.y - paddingY)),
      width: Math.round(best.width + paddingX * 2),
      height: Math.round(best.height + paddingY * 2),
      type: best.type,
      raw: best,
    };

    return {
      found: true,
      rect: finalRect,
      allTop: candidates.slice(0, 5),
    };
  });

  return result;
}

async function takeClippedScreenshot(page, clipInfo, outputPath) {
  const viewport = page.viewport() || { width: 1600, height: 1200 };

  const pageSize = await page.evaluate(() => ({
    width: Math.max(
      document.body.scrollWidth,
      document.documentElement.scrollWidth
    ),
    height: Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    ),
  }));

  const safeX = Math.max(0, clipInfo.x);
  const safeY = Math.max(0, clipInfo.y);

  const safeWidth = Math.min(
    clipInfo.width,
    Math.max(0, pageSize.width - safeX),
    Math.max(0, viewport.width - 0 + 99999)
  );

  const safeHeight = Math.min(
    clipInfo.height,
    Math.max(0, pageSize.height - safeY)
  );

  if (safeWidth < 50 || safeHeight < 50) {
    throw new Error(`Geçersiz kırpma alanı: X:${safeX} Y:${safeY} W:${safeWidth} H:${safeHeight}`);
  }

  await page.screenshot({
    path: outputPath,
    clip: {
      x: safeX,
      y: safeY,
      width: safeWidth,
      height: safeHeight,
    },
  });

  return {
    x: safeX,
    y: safeY,
    width: safeWidth,
    height: safeHeight,
  };
}

async function main() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--start-maximized",
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: 1600,
      height: 1200,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    await sendTelegramMessage("Liste açılıyor...");
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await sleep(4000);

    await closePopups(page);
    await autoScrollToBottom(page);

    const firstTicker = await getFirstTicker(page);

    if (!firstTicker) {
      const listFail = "liste_hata.png";
      await page.screenshot({ path: listFail, fullPage: true });
      await sendTelegramPhoto(listFail, "İlk hisse bulunamadı.");
      throw new Error("İlk ticker bulunamadı.");
    }

    await sendTelegramMessage(`İlk hisse bulundu: ${firstTicker}`);

    const detailPage = await browser.newPage();

    await detailPage.setViewport({
      width: 1600,
      height: 1200,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });

    await detailPage.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    const detailUrl = DETAIL_URL + encodeURIComponent(firstTicker);

    await sendTelegramMessage(`Detay açılıyor: ${detailUrl}`);
    await detailPage.goto(detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });

    await sleep(5000);
    await closePopups(detailPage);
    await sleep(2000);
    await waitForChartContent(detailPage);
    await sleep(2000);

    const fullPath = "detail_full.png";
    await detailPage.screenshot({ path: fullPath, fullPage: true });
    await sendTelegramPhoto(fullPath, `${firstTicker} detay sayfası tam ekran`);

    const clipResult = await findBestChartClip(detailPage);

    if (!clipResult.found) {
      await sendTelegramMessage(
        `Grafik alanı DOM'dan bulunamadı.\nSVG:${clipResult.debug.svgCount} CANVAS:${clipResult.debug.canvasCount} IMG:${clipResult.debug.imgCount}`
      );
      throw new Error("Grafik alanı bulunamadı.");
    }

    const rect = clipResult.rect;

    await detailPage.evaluate((y) => {
      window.scrollTo(0, Math.max(0, y - 120));
    }, rect.y);

    await sleep(1500);

    const cropPath = "detail_crop.png";
    const finalClip = await takeClippedScreenshot(detailPage, rect, cropPath);

    await sendTelegramPhoto(
      cropPath,
      [
        `${firstTicker} grafik kırpıldı`,
        `Tip: ${rect.type}`,
        `X:${finalClip.x} Y:${finalClip.y} W:${finalClip.width} H:${finalClip.height}`,
      ].join("\n")
    );

    await sendTelegramMessage("Bitti.");
    await detailPage.close();
  } catch (err) {
    console.error(err);
    try {
      await sendTelegramMessage(`Hata: ${err.message}`);
    } catch {}
    throw err;
  } finally {
    await browser.close();
  }
}

main();