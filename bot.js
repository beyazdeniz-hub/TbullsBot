const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const LIST_URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

const OUT_DIR = path.join(__dirname, "screens");

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

async function autoScrollList(page) {
  let lastHeight = 0;
  let stableCount = 0;

  for (let i = 0; i < 60; i++) {
    const currentHeight = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });

    await sleep(1500);

    if (currentHeight === lastHeight) {
      stableCount++;
    } else {
      stableCount = 0;
      lastHeight = currentHeight;
    }

    if (stableCount >= 3) break;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1200);
}

async function getFirstTicker(page) {
  const ticker = await page.evaluate(() => {
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

    const links = Array.from(document.querySelectorAll("a"));

    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").trim();

      if (/SignalPage\.aspx/i.test(href) || /Ticker=/i.test(href)) {
        const match = href.match(/Ticker=([^&]+)/i);
        if (match && match[1]) {
          return normalizeTicker(decodeURIComponent(match[1]));
        }

        if (/^[A-ZÇĞİÖŞÜ.]{2,10}$/.test(text)) {
          return normalizeTicker(text);
        }
      }
    }

    const rows = Array.from(document.querySelectorAll("tr"));
    for (const tr of rows) {
      const rowText = tr.innerText.replace(/\s+/g, " ").trim();
      if (!rowText) continue;
      if (!/al/i.test(rowText)) continue;

      const candidates = rowText.match(/\b[A-ZÇĞİÖŞÜ]{2,10}\b/g) || [];
      if (candidates.length > 0) {
        return normalizeTicker(candidates[0]);
      }
    }

    return null;
  });

  return ticker;
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
      height: 1600,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    await telegramSendMessage("<b>Test başladı</b>\nListe sayfasına gidiliyor.");

    await page.goto(LIST_URL, {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    await sleep(3000);
    await acceptCookiesIfAny(page);
    await autoScrollList(page);

    const ticker = await getFirstTicker(page);

    if (!ticker) {
      throw new Error("İlk hisse bulunamadı.");
    }

    await telegramSendMessage(
      `<b>İlk hisse bulundu</b>\nTicker: <b>${escapeHtml(ticker)}</b>`
    );

    const detailPage = await browser.newPage();

    await detailPage.setUserAgent(
      "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    );

    await detailPage.setViewport({
      width: 430,
      height: 1600,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    const detailUrl = `${DETAIL_URL}${encodeURIComponent(ticker)}`;

    await detailPage.goto(detailUrl, {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    await sleep(5000);
    await acceptCookiesIfAny(detailPage);
    await sleep(2000);

    const filePath = path.join(OUT_DIR, `${ticker}_detail_full.png`);

    await detailPage.screenshot({
      path: filePath,
      fullPage: true,
    });

    await telegramSendPhoto(
      filePath,
      `<b>Test ekran görüntüsü</b>\nHisse: <b>${escapeHtml(ticker)}</b>`
    );

    await detailPage.close().catch(() => {});
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