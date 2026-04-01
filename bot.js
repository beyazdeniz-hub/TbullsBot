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

async function telegramMesaj(text) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
  });
}

async function telegramFoto(path, caption = "") {
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("caption", caption);
  form.append("photo", fs.createReadStream(path));

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders(),
  });
}

async function sayfayiAsagiKaydir(page) {
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1500);
  }
}

async function ilkHisse(page) {
  await page.goto(LIST_URL, { waitUntil: "networkidle2" });
  await sleep(4000);

  await sayfayiAsagiKaydir(page);

  const ticker = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll("a, td, span"))
      .map(el => (el.innerText || "").trim())
      .filter(Boolean);

    for (const t of texts) {
      const temiz = t.replace(/[^A-ZÇĞİÖŞÜ]/g, "");
      if (/^[A-ZÇĞİÖŞÜ]{3,6}$/.test(temiz)) {
        return temiz;
      }
    }

    return null;
  });

  return ticker;
}

async function fullScreenshotAl(page, ticker) {
  const url = `${DETAIL_URL}${ticker}`;

  await page.goto(url, { waitUntil: "networkidle2" });
  await sleep(6000);

  // Büyük viewport veriyoruz ki grafik net çıksın
  await page.setViewport({
    width: 1400,
    height: 2000,
  });

  await sleep(2000);

  const file = `full_${ticker}.png`;

  await page.screenshot({
    path: file,
    fullPage: true,
  });

  return file;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  try {
    const ticker = await ilkHisse(page);

    if (!ticker) {
      throw new Error("Hisse bulunamadı");
    }

    await telegramMesaj(`Hisse bulundu: ${ticker}\nFull ekran alınıyor...`);

    const file = await fullScreenshotAl(page, ticker);

    await telegramFoto(file, `${ticker} detay sayfası`);

    console.log("Bitti:", ticker);
  } catch (err) {
    console.log("Hata:", err.message);
    await telegramMesaj("Hata: " + err.message);
  }

  await browser.close();
}

main();