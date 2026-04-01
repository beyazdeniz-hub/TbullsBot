const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const Jimp = require("jimp");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const LIST_URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

const OUT_DIR = path.join(__dirname, "charts");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function telegramSendPhoto(photoPath, caption) {
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("photo", fs.createReadStream(photoPath));
  form.append("caption", caption);
  form.append("parse_mode", "HTML");

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders(),
  });
}

async function getFirstTicker(page) {
  return await page.evaluate(() => {
    const link = document.querySelector("a[href*='SignalPage']");
    if (!link) return null;

    const href = link.getAttribute("href");
    const match = href.match(/Ticker=([^&]+)/);
    return match ? match[1] : null;
  });
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: 430,
      height: 1600,
      isMobile: true,
    });

    await page.goto(LIST_URL, { waitUntil: "networkidle2" });
    await sleep(3000);

    const ticker = await getFirstTicker(page);

    if (!ticker) throw new Error("Ticker bulunamadı");

    const detailPage = await browser.newPage();

    await detailPage.setViewport({
      width: 430,
      height: 1600,
      isMobile: true,
    });

    await detailPage.goto(
      `${DETAIL_URL}${encodeURIComponent(ticker)}`,
      { waitUntil: "networkidle2" }
    );

    await sleep(5000);

    const fullPath = path.join(OUT_DIR, "full.png");
    const cropPath = path.join(OUT_DIR, "chart.png");

    if (!fs.existsSync(OUT_DIR)) {
      fs.mkdirSync(OUT_DIR);
    }

    await detailPage.screenshot({
      path: fullPath,
      fullPage: true,
    });

    const img = await Jimp.read(fullPath);

    const w = img.bitmap.width;
    const h = img.bitmap.height;

    // 🔥 GRAFİK ALANI (en önemli yer)
    const cropX = 10;
    const cropY = Math.floor(h * 0.28);
    const cropW = w - 20;
    const cropH = Math.floor(h * 0.45);

    img.crop(cropX, cropY, cropW, cropH);
    await img.writeAsync(cropPath);

    await telegramSendPhoto(
      cropPath,
      `Grafik\nHisse: ${ticker}`
    );

  } finally {
    await browser.close();
  }
}

main();