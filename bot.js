const puppeteer = require("puppeteer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const URL = "https://www.turkishbulls.com/";
const SCREENSHOT_PATH = "turkishbulls-homepage.png";

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
    maxContentLength: Infinity,
  });
}

async function main() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID tanımlı değil.");
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: {
        width: 1440,
        height: 900,
      },
    });

    const page = await browser.newPage();

    await page.goto(URL, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await sleep(4000);

    await page.screenshot({
      path: SCREENSHOT_PATH,
      fullPage: true,
    });

    await sendTelegramPhoto(
      SCREENSHOT_PATH,
      "Turkishbulls anasayfa ekran görüntüsü"
    );

    console.log("Ekran görüntüsü alındı ve Telegram'a gönderildi.");
  } catch (error) {
    console.error("Hata:", error.message);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }

    if (fs.existsSync(SCREENSHOT_PATH)) {
      fs.unlinkSync(SCREENSHOT_PATH);
    }
  }
}

main();