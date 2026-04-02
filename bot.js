const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const LIST_URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

// ADRES SATIRI HİZASINDAN KESMEK İÇİN:
// y = 0'dan başlatıyoruz
const CLIP_X = 0;
const CLIP_Y = 0;
const CLIP_WIDTH = 1400;
const CLIP_HEIGHT = 500;

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
          await sleep(400);
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
  await sleep(1000);
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
    Math.max(0, viewport.width - x)
  );

  const height = Math.min(
    Math.round(rect.height),
    Math.max(0, pageSize.height - y),
    Math.max(0, viewport.height - y)
  );

  if (width < 50 || height < 50) {
    throw new Error(`Geçersiz kırpma alanı: X:${x} Y:${y} W:${width} H:${height}`);
  }

  return { x, y, width, height };
}

async function drawDebugBox(page, rect, labelText = "DEBUG ALANI") {
  await page.evaluate(({ box, labelText }) => {
    const old1 = document.getElementById("__chatgpt_debug_box__");
    const old2 = document.getElementById("__chatgpt_debug_label__");
    if (old1) old1.remove();
    if (old2) old2.remove();

    const div = document.createElement("div");
    div.id = "__chatgpt_debug_box__";
    div.style.position = "fixed";
    div.style.left = `${box.x}px`;
    div.style.top = `${box.y}px`;
    div.style.width = `${box.width}px`;
    div.style.height = `${box.height}px`;
    div.style.border = "4px solid red";
    div.style.background = "rgba(255,0,0,0.06)";
    div.style.zIndex = "2147483647";
    div.style.pointerEvents = "none";
    div.style.boxSizing = "border-box";

    const label = document.createElement("div");
    label.id = "__chatgpt_debug_label__";
    label.textContent = `${labelText} | X:${box.x} Y:${box.y} W:${box.width} H:${box.height}`;
    label.style.position = "fixed";
    label.style.left = `${box.x}px`;
    label.style.top = `${Math.max(0, box.y)}px`;
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
  }, { box: rect, labelText });
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
    await sleep(1500);

    // Sayfayı kesin olarak en üste sabitle
    await detailPage.evaluate(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    await sleep(1000);

    // İlk ekran - tam viewport
    const firstScreenPath = "detail_first_screen.png";
    await detailPage.screenshot({
      path: firstScreenPath,
      fullPage: false,
      captureBeyondViewport: false,
    });
    await sendTelegramPhoto(firstScreenPath, `${firstTicker} detay sayfası ilk ekran`);

    // Adres satırı hizası mantığına en yakın çözüm:
    // viewport'un tam üstünden kırp
    const rawRect = {
      x: CLIP_X,
      y: CLIP_Y,
      width: CLIP_WIDTH,
      height: CLIP_HEIGHT,
    };

    const safeRect = await normalizeClip(detailPage, rawRect);

    await drawDebugBox(detailPage, safeRect, "USTTEN KESIM");
    await sleep(700);

    const debugPath = "detail_debug_box.png";
    await detailPage.screenshot({
      path: debugPath,
      fullPage: false,
      captureBeyondViewport: false,
    });
    await sendTelegramPhoto(
      debugPath,
      [
        `${firstTicker} debug işaretli ekran`,
        `Üstten kesim`,
        `X:${safeRect.x} Y:${safeRect.y} W:${safeRect.width} H:${safeRect.height}`,
      ].join("\n")
    );

    await removeDebugBox(detailPage);
    await sleep(300);

    const cropPath = "detail_crop.png";
    await detailPage.screenshot({
      path: cropPath,
      clip: {
        x: safeRect.x,
        y: safeRect.y,
        width: safeRect.width,
        height: safeRect.height,
      },
      captureBeyondViewport: false,
    });

    await sendTelegramPhoto(
      cropPath,
      [
        `${firstTicker} üstten kırpılmış görüntü`,
        `X:${safeRect.x} Y:${safeRect.y} W:${safeRect.width} H:${safeRect.height}`,
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