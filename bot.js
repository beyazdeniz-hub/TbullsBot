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
const DETAIL_DELAY_MS = 3000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toNumber(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
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
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text,
      parse_mode: html ? "HTML" : undefined
    });
  } catch (e) {
    console.log("Telegram hata:", e.message);
  }
}

async function sendTelegramPhoto(buffer, caption) {
  if (!TOKEN || !CHAT_ID) return;

  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("photo", buffer, { filename: "chart.png" });

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders()
  });
}

async function resolveChromePath() {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), ".cache", "puppeteer");
  const installed = await getInstalledBrowsers({ cacheDir });
  const selected = installed.pop();

  if (!selected) throw new Error("Chrome yok");

  return selected.executablePath;
}

async function autoScroll(page) {
  let previousHeight = 0;

  while (true) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);

    if (currentHeight === previousHeight) break;

    previousHeight = currentHeight;

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(2000);
  }
}

async function collectTickers(page) {
  return await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="Ticker="]'));
    const set = new Set();

    links.forEach(a => {
      const m = a.href.match(/Ticker=([A-Z]+)/);
      if (m) set.add(m[1]);
    });

    return Array.from(set);
  });
}

async function extractDetail(page, ticker) {
  await page.goto(`${DETAIL_URL}${ticker}`, { waitUntil: "networkidle2" });
  await sleep(3000);

  const data = await page.evaluate(() => {
    const text = document.body.innerText;

    const get = (regex) => {
      const m = text.match(regex);
      return m ? m[1] : "-";
    };

    return {
      al: get(/Al[^0-9]*([0-9.,]+)/i),
      stop: get(/Stop[^0-9]*([0-9.,]+)/i)
    };
  });

  const screenshot = await page.screenshot({ type: "png" });

  return { ...data, screenshot };
}

async function run() {
  const chromePath = await resolveChromePath();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--no-sandbox"]
  });

  const page = await browser.newPage();

  await page.goto(URL, { waitUntil: "networkidle2" });

  console.log("Scroll basladi...");
  await autoScroll(page);

  const tickers = await collectTickers(page);

  console.log("Toplam hisse:", tickers.length);

  const detailPage = await browser.newPage();

  const results = [];

  for (const ticker of tickers) {
    try {
      console.log("Isleniyor:", ticker);

      const d = await extractDetail(detailPage, ticker);

      const al = toNumber(d.al);
      const stop = toNumber(d.stop);

      if (!isNaN(al) && !isNaN(stop)) {
        const risk = ((al - stop) / al) * 100;

        if (risk <= RISK_LIMIT) {
          results.push({ ticker, al, stop, risk });

          await sendTelegramPhoto(
            d.screenshot,
            `<b>#${ticker}</b>\nAl: ${al}\nStop: ${stop}\nRisk: ${risk.toFixed(2)}%`
          );
        }
      }

    } catch (e) {
      console.log("Hata:", ticker, e.message);
    }

    await sleep(DETAIL_DELAY_MS);
  }

  results.sort((a, b) => a.risk - b.risk);

  console.log("Bitti. Sinyal:", results.length);

  await browser.close();
}

run();
