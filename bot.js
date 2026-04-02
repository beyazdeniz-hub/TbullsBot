const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const LIST_URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

// Bulduğu alanı zorla yukarı taşı
const Y_OFFSET = 120;

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
    "Onayla",
    "Çerez",
    "Cookie"
  ];

  try {
    const buttons = await page.$$("button, a, div[role='button'], span[role='button']");
    for (const btn of buttons) {
      try {
        const txt = await page.evaluate(
          (el) => (el.innerText || el.textContent || "").trim(),
          btn
        );
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

  for (let i = 0; i < 55; i++) {
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
  for (let i = 0; i < 20; i++) {
    const info = await page.evaluate(() => {
      return {
        svgCount: document.querySelectorAll("svg").length,
        canvasCount: document.querySelectorAll("canvas").length,
        imgCount: document.querySelectorAll("img").length,
      };
    });

    if (info.svgCount > 0 || info.canvasCount > 0 || info.imgCount > 0) {
      return true;
    }

    await sleep(1000);
  }
  return false;
}

async function findBestChartClip(page) {
  return await page.evaluate(() => {
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

    // 1) svg rect içinden grafik hitbox yakalama
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

    // 2) büyük svg
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

    // 3) canvas
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

    // 4) img
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

    // 5) grafik içeren büyük bloklar
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

    candidates.sort((a, b) => b.score - a.score);

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

    const best = candidates[0];

    const paddingX = 20;
    const paddingY = 20;

    return {
      found: true,
      rect: {
        x: Math.max(0, Math.round(best.x - paddingX)),
        y: Math.max(0, Math.round(best.y - paddingY)),
        width: Math.round(best.width + paddingX * 2),
        height: Math.round(best.height + paddingY * 2),
        type: best.type,
      },
      topCandidates: candidates.slice(0, 5),
    };
  });
}

async function normalizeClip(page, rect) {
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

  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));

  const width = Math.min(
    Math.round(rect.width),
    Math.max(0, pageSize.width - x),
    Math.max(0, viewport.width - 0 + 99999)
  );

  const height = Math.min(
    Math.round(rect.height),
    Math.max(0, pageSize.height - y)
  );

  if (width < 50 || height < 50) {
    throw new Error(`Geçersiz kırpma alanı: X:${x} Y:${y} W:${width} H:${height}`);
  }

  return { x, y, width, height };
}

async function drawDebugBox(page, rect) {
  await page.evaluate((box) => {
    const old = document.getElementById("__chatgpt_debug_box__");
    if (old) old.remove();

    const labelOld = document.getElementById("__chatgpt_debug_label__");
    if (labelOld) labelOld.remove();

    const div = document.createElement("div");
    div.id = "__chatgpt_debug_box__";
    div.style.position = "absolute";
    div.style.left = box.x + "px";
    div.style.top = box.y + "px";
    div.style.width = box.width + "px";
    div.style.height = box.height + "px";
    div.style.border = "4px solid red";
    div.style.background = "rgba(255,0,0,0.06)";
    div.style.zIndex = "2147483647";
    div.style.pointerEvents = "none";
    div.style.boxSizing = "border-box";

    const label = document.createElement("div");
    label.id = "__chatgpt_debug_label__";
    label.textContent = `DEBUG ALANI | ${box.type} | X:${box.x} Y:${box.y} W:${box.width} H:${box.height}`;
    label.style.position = "absolute";
    label.style.left = box.x + "px";
    label.style.top = Math.max(0, box.y - 34) + "px";
    label.style.background = "red";
    label.style.color = "white";
    label.style.padding = "6px 10px";
    label.style.fontSize = "16px";
    label.style.fontWeight = "bold";
    label.style.zIndex = "2147483647";
    label.style.pointerEvents = "none";
    label.style.fontFamily = "Arial, sans-serif";

    document.body.appendChild(div);
    document.body.appendChild(label);
  }, rect);
}

async function removeDebugBox(page) {
  await page.evaluate(() => {
    const a = document.getElementById("__chatgpt_debug_box__");
    const b = document.getElementById("__chatgpt_debug_label__");
    if (a) a.remove();
    if (b) b.remove();
  });
}

async function main() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  const browser = await puppeteer.launch({
    headless: true,
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
      const failPath = "liste_hata.png";
      await page.screenshot({ path: failPath, fullPage: true });
      await sendTelegramPhoto(failPath, "İlk hisse bulunamadı.");
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
    await sleep(2500);

    const fullPath = "detail_full.png";
    await detailPage.screenshot({ path: fullPath, fullPage: true });
    await sendTelegramPhoto(fullPath, `${firstTicker} detay sayfası tam ekran`);

    const clipResult = await findBestChartClip(detailPage);

    if (!clipResult.found) {
      await sendTelegramMessage(
        `Grafik alanı bulunamadı.\nSVG:${clipResult.debug.svgCount} CANVAS:${clipResult.debug.canvasCount} IMG:${clipResult.debug.imgCount}`
      );
      throw new Error("Grafik alanı DOM üzerinden bulunamadı.");
    }

    const rawRect = clipResult.rect;
    const safeRect = await normalizeClip(detailPage, rawRect);

    // Burada alanı yukarı kaydırıyoruz
    const shiftedRect = {
      ...safeRect,
      y: Math.max(0, safeRect.y - Y_OFFSET),
    };

    await detailPage.evaluate((y) => {
      window.scrollTo(0, Math.max(0, y - 120));
    }, shiftedRect.y);

    await sleep(1500);

    await drawDebugBox(detailPage, {
      ...shiftedRect,
      type: rawRect.type,
    });

    await sleep(1000);

    const debugPath = "detail_debug_box.png";
    await detailPage.screenshot({ path: debugPath, fullPage: true });
    await sendTelegramPhoto(
      debugPath,
      [
        `${firstTicker} debug işaretli ekran`,
        `Tip: ${rawRect.type}`,
        `Yukarı kaydırma: ${Y_OFFSET}px`,
        `X:${shiftedRect.x} Y:${shiftedRect.y} W:${shiftedRect.width} H:${shiftedRect.height}`,
      ].join("\n")
    );

    await removeDebugBox(detailPage);
    await sleep(500);

    const cropPath = "detail_crop.png";
    await detailPage.screenshot({
      path: cropPath,
      clip: {
        x: shiftedRect.x,
        y: shiftedRect.y,
        width: shiftedRect.width,
        height: shiftedRect.height,
      },
    });

    await sendTelegramPhoto(
      cropPath,
      [
        `${firstTicker} kırpılmış grafik`,
        `Tip: ${rawRect.type}`,
        `Yukarı kaydırma: ${Y_OFFSET}px`,
        `X:${shiftedRect.x} Y:${shiftedRect.y} W:${shiftedRect.width} H:${shiftedRect.height}`,
      ].join("\n")
    );

    if (clipResult.topCandidates?.length) {
      const topText = clipResult.topCandidates
        .map((c, i) => {
          return `${i + 1}) ${c.type} | X:${Math.round(c.x)} Y:${Math.round(c.y)} W:${Math.round(c.width)} H:${Math.round(c.height)} | score:${Math.round(c.score)}`;
        })
        .join("\n");

      await sendTelegramMessage(`En güçlü adaylar:\n${topText}`);
    }

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