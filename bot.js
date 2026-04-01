const puppeteer = require("puppeteer");
const axios = require("axios");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

async function sendPhoto(buffer) {
  const formData = new FormData();
  formData.append("chat_id", CHAT_ID);
  formData.append("photo", buffer, "chart.png");

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, formData, {
    headers: formData.getHeaders(),
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // Mozilla görünümü
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  );

  await page.setViewport({ width: 1366, height: 900 });

  await page.goto(URL, { waitUntil: "networkidle2" });

  await page.waitForTimeout(3000);

  // İlk hisseye gir
  const firstTicker = await page.evaluate(() => {
    const el = document.querySelector("table tbody tr td a");
    return el ? el.innerText.trim() : null;
  });

  console.log("İlk hisse:", firstTicker);

  await page.goto(DETAIL_URL + firstTicker, { waitUntil: "networkidle2" });

  await page.waitForTimeout(5000);

  // 🔥 SVG grafik alanını bul
  const chartElement = await page.$("svg");

  if (!chartElement) {
    console.log("Grafik bulunamadı");
    await browser.close();
    return;
  }

  // 🔥 SADECE GRAFİĞİ SCREENSHOT AL
  const buffer = await chartElement.screenshot({
    type: "png",
  });

  // Telegram'a gönder
  const FormData = require("form-data");
  const formData = new FormData();
  formData.append("chat_id", CHAT_ID);
  formData.append("photo", buffer, "chart.png");

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, formData, {
    headers: formData.getHeaders(),
  });

  await browser.close();
})();