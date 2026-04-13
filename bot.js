const puppeteer = require("puppeteer");
const { getInstalledBrowsers } = require("@puppeteer/browsers");
const axios = require("axios");
const FormData = require("form-data");
const os = require("os");
const path = require("path");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

const URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

const RISK_LIMIT = 5;
const DETAIL_DELAY_MS = 2000;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function toNumber(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/\./g, "") // BURASI DÜZELTİLDİ (senin kodda .* olmuştu)
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const num = parseFloat(normalized);
  return Number.isNaN(num) ? NaN : num;
}

function getTurkeyNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
}

function formatTurkeyDateTime() {
  return new Date().toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function getTimeCategory() {
  const hour = getTurkeyNow().getHours();
  if (hour === 21) return "onay";
  if (hour >= 9 && hour <= 18) return "seans";
  return "diger";
}

async function sendTelegram(text, html = false) {
  if (!TOKEN || !CHAT_ID) return;

  try {
    const payload = {
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: true
    };

    if (html) payload.parse_mode = "HTML";

    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, payload);
  } catch (e) {
    console.log("Telegram mesaj hatasi:", e.response?.data || e.message);
  }
}

async function sendTelegramPhoto(photoBuffer, caption) {
  if (!TOKEN || !CHAT_ID) return;

  try {
    const formData = new FormData();
    formData.append("chat_id", CHAT_ID);
    formData.append("caption", caption);
    formData.append("parse_mode", "HTML");
    formData.append("photo", photoBuffer, { filename: "chart.png" });

    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, formData, {
      headers: formData.getHeaders()
    });
  } catch (e) {
    console.log("Telegram resim hatasi:", e.response?.data || e.message);
  }
}

async function resolveChromePath() {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), ".cache", "puppeteer");
  const installed = await getInstalledBrowsers({ cacheDir });

  const selected =
    installed.filter((b) => String(b.browser).toLowerCase().includes("chrome")).pop()
    || installed.pop();

  if (!selected || !selected.executablePath) throw new Error("Chrome bulunamadi.");

  return selected.executablePath;
}

async function safeGoto(page, url, waitMode = "networkidle2") {
  await page.goto(url, { waitUntil: waitMode, timeout: 60000 });
  await sleep(1500);
}

async function collectTickers(page) {
  return await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="SignalPage"]'));
    const set = new Set();

    for (const a of links) {
      const m = (a.getAttribute("href") || "").match(/Ticker=([A-Z]+)/i);
      if (m && m[1]) set.add(m[1].toUpperCase());
    }

    return Array.from(set);
  });
}

async function extractDetailAndChart(detailPage, ticker) {
  await safeGoto(detailPage, `${DETAIL_URL}${ticker}`, "networkidle0");

  await sleep(4000);

  let screenshotBuffer = null;

  try {
    screenshotBuffer = await detailPage.screenshot({
      type: "png",
      clip: { x: 0, y: 330, width: 500, height: 430 }
    });

    console.log(`${ticker} grafik alindi.`);
  } catch (e) {
    console.log(`${ticker} grafik hatasi: ${e.message}`);
  }

  const levels = await detailPage.evaluate(() => {
    const bodyText = (document.body.innerText || "").replace(/\s+/g, " ");

    const pick = (patterns) => {
      for (const re of patterns) {
        const m = bodyText.match(re);
        if (m?.[1]) return m[1].trim();
      }
      return "-";
    };

    return {
      alSeviyesi: pick([
        /Al[^a-z]*?([0-9]+[.,][0-9]+)/i,
        /Alis[^a-z]*?([0-9]+[.,][0-9]+)/i
      ]),
      stoploss: pick([
        /Stop[^a-z]*?([0-9]+[.,][0-9]+)/i
      ])
    };
  });

  return { ...levels, screenshotBuffer };
}

async function run() {
  const chromePath = await resolveChromePath();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--no-sandbox"]
  });

  try {
    const page = await browser.newPage();

    await safeGoto(page, URL);

    const tickers = await collectTickers(page);

    console.log(`Toplam ${tickers.length} hisse bulundu.`);

    const detailPage = await browser.newPage();

    const results = [];

    const testTickers = ["THYAO"]; // aynen bıraktım

    for (const ticker of testTickers) {
      try {
        const detail = await extractDetailAndChart(detailPage, ticker);

        const al = toNumber(detail.alSeviyesi);
        const stop = toNumber(detail.stoploss);

        console.log(`${ticker} -> Al: ${detail.alSeviyesi} Stop: ${detail.stoploss}`);

        if (detail.screenshotBuffer) {
          await sendTelegramPhoto(
            detail.screenshotBuffer,
            `<b>#${ticker}</b>\nAl: ${detail.alSeviyesi}\nStop: ${detail.stoploss}`
          );
        }

        if (!isNaN(al) && !isNaN(stop)) {
          const risk = ((al - stop) / al) * 100;

          if (risk <= RISK_LIMIT) {
            results.push({ ticker, al, stop, risk });
          }
        }

      } catch (e) {
        console.log(`${ticker} hata: ${e.message}`);
      }

      await sleep(DETAIL_DELAY_MS);
    }

    console.log("Bitti:", results.length);

  } finally {
    await browser.close();
  }
}

run().catch((err) => console.log("ANA HATA:", err.message));
