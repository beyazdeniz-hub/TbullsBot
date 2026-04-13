const puppeteer = require("puppeteer");
const { getInstalledBrowsers } = require("@puppeteer/browsers");
const axios = require("axios");
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
const TELEGRAM_CHUNK_SIZE = 25;
const DETAIL_DELAY_MS = 1000; // Fotoğraf yüklenmesi için süreyi biraz artırdık

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(value, width, right = false) {
  const s = String(value ?? "-").trim();
  if (s.length >= width) return s.slice(0, width);
  return right ? s.padStart(width, " ") : s.padEnd(width, " ");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" })
  );
}

function formatTurkeyDateTime() {
  return new Date().toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatTurkeyDateOnly() {
  return new Date().toLocaleDateString("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function getTimeCategory() {
  const hour = getTurkeyNow().getHours();
  if (hour === 21) return "onay";
  if (hour >= 9 && hour <= 18) return "seans";
  return "diger";
}

async function sendTelegram(text, html = false) {
  if (!TOKEN || !CHAT_ID) throw new Error("Telegram config eksik");
  const payload = { chat_id: CHAT_ID, text: text, disable_web_page_preview: true };
  if (html) payload.parse_mode = "HTML";
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, payload, { timeout: 30000 });
}

async function sendTelegramPhoto(photoBuffer, caption) {
  if (!TOKEN || !CHAT_ID) return;
  const formData = new FormData();
  formData.append("chat_id", CHAT_ID);
  formData.append("caption", caption);
  formData.append("parse_mode", "HTML");
  
  // Buffer'ı Blob'a çevirerek gönderiyoruz
  const blob = new Blob([photoBuffer], { type: 'image/png' });
  formData.append("photo", blob, "chart.png");

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, formData, { timeout: 60000 });
}

async function resolveChromePath() {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), ".cache", "puppeteer");
  const installed = await getInstalledBrowsers({ cacheDir });
  const selected = installed.filter((b) => String(b.browser).toLowerCase().includes("chrome")).pop() || installed.pop();
  if (!selected || !selected.executablePath) throw new Error("Chrome bulunamadi.");
  return selected.executablePath;
}

async function safeGoto(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3500);
}

async function collectTickers(page) {
  return await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="SignalPage"]'));
    const set = new Set();
    for (const a of links) {
      const m = (a.getAttribute("href") || "").match(/Ticker=([A-Z]+)/i);
      if (m && m[1]) set.add(m[1].toUpperCase());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  });
}

async function extractDetailAndChart(detailPage, ticker) {
  await safeGoto(detailPage, `${DETAIL_URL}${ticker}`);
  
  // Grafik elementinin yüklenmesini bekle
  let screenshotBuffer = null;
  try {
    const chartSelector = "#ChartImage";
    await detailPage.waitForSelector(chartSelector, { timeout: 5000 });
    const chartElement = await detailPage.$(chartSelector);
    if (chartElement) {
      screenshotBuffer = await chartElement.screenshot();
    }
  } catch (e) {
    console.log(`${ticker} için grafik alınamadı.`);
  }

  const levels = await detailPage.evaluate(() => {
    const bodyText = (document.body.innerText || "").replace(/\s+/g, " ");
    const pick = (re) => { const m = bodyText.match(re); return m ? m[1].trim() : "-"; };
    return {
      alSeviyesi: pick(/Alış\s*Seviyesi[:\s]*([0-9.,]+)/i) || pick(/Al[:\s]*([0-9.,]+)/i),
      stoploss: pick(/Stoploss[:\s]*([0-9.,]+)/i) || pick(/Stop[:\s]*([0-9.,]+)/i)
    };
  });

  return { ...levels, screenshotBuffer };
}

async function uploadJsonToGithub(remotePath, data, message) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return;
  const content = Buffer.from(JSON.stringify(data, null, 2), "utf8").toString("base64");
  let sha = null;
  try {
    const res = await axios.get(`https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${remotePath}?ref=${GITHUB_BRANCH}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` }
    });
    sha = res.data.sha;
  } catch (e) {}

  await axios.put(`https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${remotePath}`, 
    { message, content, branch: GITHUB_BRANCH, ...(sha ? { sha } : {}) },
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
  );
}

async function run() {
  const chromePath = await resolveChromePath();
  const browser = await puppeteer.launch({ headless: true, executablePath: chromePath, args: ["--no-sandbox"] });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 2000 });
    await safeGoto(page, URL);
    
    // Basit scroll (Sizin koddaki mantık)
    await page.evaluate(async () => { window.scrollBy(0, 5000); });
    await sleep(3000);

    const tickers = await collectTickers(page);
    if (!tickers.length) {
      await sendTelegram("Bot hatasi: Liste bos.");
      return;
    }

    const detailPage = await browser.newPage();
    const results = [];

    for (const ticker of tickers) {
      try {
        const detail = await extractDetailAndChart(detailPage, ticker);
        const alisNum = toNumber(detail.alSeviyesi);
        const stopNum = toNumber(detail.stoploss);

        if (!isNaN(alisNum) && !isNaN(stopNum) && alisNum > 0 && stopNum < alisNum) {
          const risk = ((alisNum - stopNum) / alisNum) * 100;
          if (risk <= RISK_LIMIT) {
            results.push({ ticker, alis: detail.alSeviyesi, stop: detail.stoploss, risk });
            
            // Grafik varsa Telegram'a gönder
            if (detail.screenshotBuffer) {
              const caption = `<b>#${ticker}</b>\nAlış: ${detail.alSeviyesi}\nStop: ${detail.stoploss}\nRisk: %${risk.toFixed(2)}`;
              await sendTelegramPhoto(detail.screenshotBuffer, caption);
            }
          }
        }
      } catch (e) { console.log(`${ticker} hata: ${e.message}`); }
      await sleep(DETAIL_DELAY_MS);
    }

    results.sort((a, b) => a.risk - b.risk);
    const category = getTimeCategory();
    const updatedAt = formatTurkeyDateTime();

    // JSON Güncellemeleri
    const payload = { updatedAt, signals: results.map(r => ({ ...r, risk: r.risk.toFixed(2) })) };
    await uploadJsonToGithub("signals.json", payload, `Update ${updatedAt}`);
    if (category === "seans") await uploadJsonToGithub("seans.json", payload, `Update ${updatedAt}`);
    if (category === "onay") await uploadJsonToGithub("onay.json", payload, `Update ${updatedAt}`);

    await sendTelegram(`NeuroTrade Güncellendi\nKategori: ${category}\nToplam: ${results.length}`);
  } finally {
    await browser.close();
  }
}

run().catch(err => console.log("HATA:", err.message));
