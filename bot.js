const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=AGESA";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function telegramMesajGonder(text) {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
  });
}

async function telegramResimGonder(filePath, caption = "") {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("caption", caption);
  form.append("photo", fs.createReadStream(filePath));

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });
}

async function main() {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
      defaultViewport: null,
    });

    const page = await browser.newPage();

    // Mozilla / Firefox görünümü
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0"
    );

    await page.setExtraHTTPHeaders({
      "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    // Masaüstü görünümü
    await page.setViewport({
      width: 1600,
      height: 2200,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });

    await telegramMesajGonder("AGESA detay sayfası Mozilla masaüstü görünümünde açılıyor...");

    await page.goto(DETAIL_URL, {
      waitUntil: "networkidle2",
      timeout: 90000,
    });

    await sleep(8000);

    const filePath = "agesa_full_page.png";

    await page.screenshot({
      path: filePath,
      fullPage: true,
    });

    await telegramResimGonder(
      filePath,
      "AGESA detay sayfası - Mozilla masaüstü görünümü - tam ekran görüntüsü"
    );

    console.log("Tamamlandı:", filePath);
  } catch (error) {
    console.error("HATA:", error.message);

    try {
      await telegramMesajGonder(`Bot hatası:\n${error.message}`);
    } catch (e) {
      console.error("Telegram hata bildirimi de gönderilemedi:", e.message);
    }

    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();