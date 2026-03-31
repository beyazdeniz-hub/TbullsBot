const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const Jimp = require("jimp");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

const OUT_DIR = path.join(__dirname, "charts");
const MAX_SYMBOLS = 80;
const WAIT_BETWEEN_SYMBOLS = 1200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function telegramSendMessage(text) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

async function telegramSendPhoto(photoPath, caption) {
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("photo", fs.createReadStream(photoPath));
  form.append("caption", caption);
  form.append("parse_mode", "HTML");

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000,
  });
}

async function acceptCookiesIfAny(page) {
  const possibleTexts = ["Kabul", "Accept", "Tamam", "I Agree", "Anladım"];

  try {
    const elements = await page.$$("button, a, input[type='button'], input[type='submit']");
    for (const el of elements) {
      const value = await page.evaluate((node) => {
        return (node.innerText || node.textContent || node.value || "").trim();
      }, el);

      if (possibleTexts.some((t) => value.toLowerCase() === t.toLowerCase())) {
        await el.click().catch(() => {});
        await sleep(1000);
        break;
      }
    }
  } catch (_) {}
}

async function removeFixedAds(page) {
  try {
    await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("*"));
      for (const el of nodes) {
        const s = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        const looksFixed =
          s.position === "fixed" || s.position === "sticky";

        const bigBottomBar =
          rect.width > window.innerWidth * 0.6 &&
          rect.height > 40 &&
          rect.bottom >= window.innerHeight - 5;

        const iframeOrAd =
          el.tagName === "IFRAME" ||
          el.tagName === "INS" ||
          (el.innerText || "").toLowerCase().includes("reklam");

        if ((looksFixed && bigBottomBar) || iframeOrAd) {
          el.style.display = "none";
        }
      }
    });
  } catch (_) {}
}

async function autoScrollToBottom(page) {
  let lastHeight = 0;
  let stable = 0;

  for (let i = 0; i < 100; i++) {
    const h = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });

    await sleep(1700);

    if (h === lastHeight) stable++;
    else {
      stable = 0;
      lastHeight = h;
    }

    if (stable >= 4) break;
  }

  await sleep(1000);
}

async function extractTickers(page) {
  const tickers = await page.evaluate(() => {
    const normalizeTicker = (text) =>
      String(text || "")
        .trim()
        .toUpperCase()
        .replace(/Ç/g, "C")
        .replace(/Ğ/g, "G")
        .replace(/İ/g, "I")
        .replace(/Ö/g, "O")
        .replace(/Ş/g, "S")
        .replace(/Ü/g, "U");

    const found = [];

    const links = Array.from(document.querySelectorAll("a"));
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").trim();

      if (/SignalPage\.aspx/i.test(href) || /Ticker=/i.test(href)) {
        let ticker = null;

        const match = href.match(/Ticker=([^&]+)/i);
        if (match && match[1]) {
          ticker = decodeURIComponent(match[1]);
        } else if (/^[A-ZÇĞİÖŞÜ.]{2,10}$/.test(text)) {
          ticker = text;
        }

        ticker = normalizeTicker(ticker);
        if (/^[A-Z.]{2,10}$/.test(ticker)) {
          found.push(ticker);
        }
      }
    }

    const rows = Array.from(document.querySelectorAll("tr"));
    for (const tr of rows) {
      const rowText = tr.innerText.replace(/\s+/g, " ").trim();
      if (!rowText) continue;
      if (!/al/i.test(rowText)) continue;

      const candidates = rowText.match(/\b[A-ZÇĞİÖŞÜ]{2,10}\b/g) || [];
      for (const c of candidates) {
        const ticker = normalizeTicker(c);
        if (/^[A-Z.]{2,10}$/.test(ticker)) {
          found.push(ticker);
        }
      }
    }

    return [...new Set(found)];
  });

  return tickers.slice(0, MAX_SYMBOLS);
}

async function findSignalHeaderBox(page) {
  const handle = await page.evaluateHandle(() => {
    const wanted = [
      "SATIN ALMAK",
      "SENETTE KAL",
      "BUY",
      "AL",
      "SAT"
    ];

    const elements = Array.from(document.querySelectorAll("div, span, td, h1, h2, h3, h4"));

    let best = null;

    for (const el of elements) {
      const txt = (el.innerText || "").replace(/\s+/g, " ").trim().toUpperCase();
      if (!txt) continue;

      const match = wanted.some((w) => txt.includes(w));
      if (!match) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 20) continue;
      if (rect.top < 80 || rect.top > 900) continue;

      best = el;
      break;
    }

    return best;
  });

  const el = handle.asElement();
  if (!el) return null;

  const box = await el.boundingBox();
  return box || null;
}

async function captureChartCrop(page, ticker) {
  ensureDir(OUT_DIR);

  const safeTicker = ticker.replace(/[^\w.-]/g, "_");
  const fullPath = path.join(OUT_DIR, `${safeTicker}_full.png`);
  const cropPath = path.join(OUT_DIR, `${safeTicker}.png`);

  await page.screenshot({
    path: fullPath,
    fullPage: true,
  });

  const img = await Jimp.read(fullPath);
  const pageWidth = img.bitmap.width;
  const pageHeight = img.bitmap.height;

  const headerBox = await findSignalHeaderBox(page);

  let cropX = 8;
  let cropY = 360;
  let cropW = pageWidth - 16;
  let cropH = 520;

  if (headerBox) {
    cropX = Math.max(0, Math.floor(headerBox.x) - 10);
    cropY = Math.max(0, Math.floor(headerBox.y + headerBox.height + 5));
    cropW = Math.min(pageWidth - cropX - 8, Math.max(260, Math.floor(pageWidth - cropX - 12)));
    cropH = 560;
  }

  if (cropY + cropH > pageHeight) {
    cropH = pageHeight - cropY - 10;
  }

  if (cropW < 200 || cropH < 150) {
    return null;
  }

  img.crop(cropX, cropY, cropW, cropH);
  await img.writeAsync(cropPath);

  if (!fs.existsSync(cropPath) || fs.statSync(cropPath).size < 4000) {
    return null;
  }

  return cropPath;
}

async function processTicker(browser, ticker) {
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    );

    await page.setViewport({
      width: 430,
      height: 1400,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    const detailUrl = `${DETAIL_URL}${encodeURIComponent(ticker)}`;
    await page.goto(detailUrl, {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    await sleep(2500);
    await acceptCookiesIfAny(page);
    await removeFixedAds(page);

    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1200);

    return await captureChartCrop(page, ticker);
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  ensureDir(OUT_DIR);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    );

    await page.setViewport({
      width: 430,
      height: 1400,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    await page.goto(URL, {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    await sleep(3000);
    await acceptCookiesIfAny(page);
    await autoScrollToBottom(page);

    const tickers = await extractTickers(page);

    if (!tickers.length) {
      await telegramSendMessage("Hiç hisse bulunamadı.");
      return;
    }

    const now = new Date().toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
    });

    await telegramSendMessage(
      `<b>Turkishbulls Grafik Taraması</b>\n` +
      `Tarama zamanı: <b>${escapeHtml(now)}</b>\n` +
      `Bulunan hisse: <b>${tickers.length}</b>`
    );

    for (const ticker of tickers) {
      try {
        const imagePath = await processTicker(browser, ticker);

        if (!imagePath || !fs.existsSync(imagePath)) {
          await telegramSendMessage(
            `<b>${escapeHtml(ticker)}</b>\nGrafik kırpılamadı.`
          );
        } else {
          await telegramSendPhoto(imagePath, `<b>${escapeHtml(ticker)}</b>`);
        }
      } catch (err) {
        await telegramSendMessage(
          `<b>${escapeHtml(ticker)}</b>\nHata: <code>${escapeHtml(err.message || String(err))}</code>`
        );
      }

      await sleep(WAIT_BETWEEN_SYMBOLS);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(async (err) => {
  console.error(err);
  if (TOKEN && CHAT_ID) {
    try {
      await telegramSendMessage(
        `Bot hata verdi:\n<code>${escapeHtml(err.message || String(err))}</code>`
      );
    } catch (_) {}
  }
  process.exit(1);
});