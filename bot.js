const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTelegramMessage(text) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
  });
}

async function sendTelegramPhoto(photoPath, caption = "") {
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("caption", caption);
  form.append("photo", fs.createReadStream(photoPath));

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });
}

async function getFirstTicker(page) {
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 120000 });
  await sleep(5000);

  for (let i = 0; i < 25; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(1200);
  }

  const ticker = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a"));

    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").trim().toUpperCase();

      if (
        text &&
        /^[A-ZÇĞİÖŞÜ]{2,10}$/.test(text) &&
        (href.includes("SignalPage.aspx") || href.includes("Ticker="))
      ) {
        return text;
      }
    }

    const bodyText = document.body.innerText || "";
    const lines = bodyText.split("\n").map((x) => x.trim()).filter(Boolean);

    for (const line of lines) {
      const t = line.toUpperCase();
      if (/^[A-ZÇĞİÖŞÜ]{2,10}$/.test(t)) {
        return t;
      }
    }

    return null;
  });

  return ticker;
}

async function captureChart(page, ticker) {
  const detailUrl = `${DETAIL_URL}${encodeURIComponent(ticker)}`;
  await page.goto(detailUrl, { waitUntil: "networkidle2", timeout: 120000 });

  await page.setViewport({
    width: 1000,
    height: 1600,
    deviceScaleFactor: 1,
  });

  await sleep(8000);

  // Sayfa en üste alınsın ki koordinat sabit çalışsın
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1500);

  const outputDir = path.join(__dirname, "tmp");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const photoPath = path.join(outputDir, `${ticker}_chart.png`);

  // SADECE sabit kırpma kullanılacak
  // Üstü daha yukarı aldım
  const clip = {
    x: 0,
    y: 10,
    width: 950,
    height: 420,
  };

  const vp = page.viewport();

  if (clip.x < 0) clip.x = 0;
  if (clip.y < 0) clip.y = 0;

  if (clip.x + clip.width > vp.width) {
    clip.width = vp.width - clip.x;
  }

  if (clip.y + clip.height > vp.height) {
    clip.height = vp.height - clip.y;
  }

  await page.screenshot({
    path: photoPath,
    clip,
  });

  return { photoPath, detailUrl, clip };
}

async function main() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1000,1600",
    ],
    defaultViewport: {
      width: 1000,
      height: 1600,
    },
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    await page.setExtraHTTPHeaders({
      "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    await sendTelegramMessage("İlk hisse açılıyor, sabit koordinatla daha yukarıdan ekran alınacak...");

    const ticker = await getFirstTicker(page);

    if (!ticker) {
      throw new Error("İlk hisse bulunamadı.");
    }

    const { photoPath, detailUrl, clip } = await captureChart(page, ticker);

    await sendTelegramPhoto(
      photoPath,
      `Hisse: ${ticker}\nDetay: ${detailUrl}\nKırpma: x=${clip.x}, y=${clip.y}, w=${clip.width}, h=${clip.height}`
    );

    console.log("Tamamlandı:", ticker, clip);
  } catch (err) {
    console.error("HATA:", err);
    try {
      await sendTelegramMessage(`Hata oluştu: ${err.message}`);
    } catch (_) {}
    throw err;
  } finally {
    await browser.close();
  }
}

main();