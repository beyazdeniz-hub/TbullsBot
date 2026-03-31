const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

const MAX_ROWS = 20; // ilk etapta 20 hisse gönder
const SCREENSHOT_DIR = path.join(__dirname, "mini_charts");
const WAIT_BETWEEN_SYMBOLS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function toNumber(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function telegramSendPhoto(photoPath, caption) {
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("photo", fs.createReadStream(photoPath));
  form.append("caption", caption);
  form.append("parse_mode", "HTML");

  await axios.post(
    `https://api.telegram.org/bot${TOKEN}/sendPhoto`,
    form,
    { headers: form.getHeaders(), maxBodyLength: Infinity }
  );
}

async function telegramSendMessage(text) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

async function autoScroll(page) {
  let lastHeight = 0;
  let sameCount = 0;

  for (let i = 0; i < 40; i++) {
    const currentHeight = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });

    await sleep(1200);

    if (currentHeight === lastHeight) {
      sameCount++;
    } else {
      sameCount = 0;
      lastHeight = currentHeight;
    }

    if (sameCount >= 3) break;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1000);
}

async function extractSignalRows(page) {
  const rows = await page.evaluate(() => {
    const allText = document.body.innerText || "";
    const tables = Array.from(document.querySelectorAll("table"));
    const candidates = [];

    for (const table of tables) {
      const trs = Array.from(table.querySelectorAll("tr"));
      for (const tr of trs) {
        const tds = Array.from(tr.querySelectorAll("td"));
        const rowText = tr.innerText.replace(/\s+/g, " ").trim();

        if (!rowText) continue;
        if (!/al/i.test(rowText)) continue;

        let ticker = null;
        for (const td of tds) {
          const txt = (td.innerText || "").replace(/\s+/g, " ").trim();
          if (/^[A-ZÇĞİÖŞÜ.]{2,10}$/.test(txt)) {
            ticker = txt
              .replace(/Ç/g, "C")
              .replace(/Ğ/g, "G")
              .replace(/İ/g, "I")
              .replace(/Ö/g, "O")
              .replace(/Ş/g, "S")
              .replace(/Ü/g, "U");
            break;
          }
        }

        if (ticker) {
          candidates.push({
            ticker,
            rowText,
          });
        }
      }
    }

    const unique = [];
    const seen = new Set();
    for (const item of candidates) {
      if (!seen.has(item.ticker)) {
        seen.add(item.ticker);
        unique.push(item);
      }
    }

    return unique;
  });

  return rows;
}

async function extractDetailData(page, ticker) {
  const result = await page.evaluate((tickerArg) => {
    const text = document.body.innerText || "";

    function findValue(label) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped + "\\s*[:]?\\s*([0-9.,]+)", "i");
      const match = text.match(regex);
      return match ? match[1] : null;
    }

    const alis =
      findValue("Alış seviyesi") ||
      findValue("Alis seviyesi") ||
      findValue("Alış") ||
      findValue("Alis");

    const stop =
      findValue("Stop seviyesi") ||
      findValue("Stop") ||
      findValue("Zarar kes");

    return {
      ticker: tickerArg,
      alis,
      stop,
    };
  }, ticker);

  return result;
}

async function captureMiniChart(page, ticker) {
  const safeTicker = ticker.replace(/[^\w.-]/g, "_");
  const filePath = path.join(SCREENSHOT_DIR, `${safeTicker}.png`);

  const selectors = [
    "img[id*='Chart']",
    "img[src*='chart']",
    "img[src*='Chart']",
    "canvas",
    "#ContentPlaceHolder1_Image1",
    "#ContentPlaceHolder1_imgChart",
    ".chart img",
    ".chart canvas",
    "table img",
  ];

  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (!el) continue;

      const box = await el.boundingBox();
      if (!box || box.width < 80 || box.height < 40) continue;

      await el.screenshot({ path: filePath });
      if (fs.existsSync(filePath)) return filePath;
    } catch (e) {}
  }

  const chartHandle = await page.evaluateHandle(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    const target =
      imgs.find((img) => {
        const src = (img.getAttribute("src") || "").toLowerCase();
        return src.includes("chart") || src.includes("grafik");
      }) ||
      imgs.find((img) => {
        const w = img.width || 0;
        const h = img.height || 0;
        return w >= 150 && h >= 70;
      });

    return target || null;
  });

  const element = chartHandle.asElement();
  if (element) {
    const box = await element.boundingBox();
    if (box && box.width >= 80 && box.height >= 40) {
      await element.screenshot({ path: filePath });
      if (fs.existsSync(filePath)) return filePath;
    }
  }

  const fallbackPath = path.join(SCREENSHOT_DIR, `${safeTicker}_full.png`);
  await page.screenshot({ path: fallbackPath, fullPage: true });
  return fallbackPath;
}

async function main() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  ensureDir(SCREENSHOT_DIR);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1440, height: 2200 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    await page.goto(URL, { waitUntil: "networkidle2", timeout: 120000 });
    await sleep(3000);
    await autoScroll(page);

    const rows = await extractSignalRows(page);

    if (!rows.length) {
      await telegramSendMessage("Mini grafik botu sinyal bulamadı.");
      return;
    }

    const selected = rows.slice(0, MAX_ROWS);

    const now = new Date().toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
    });

    await telegramSendMessage(
      `<b>Mini Grafik Botu</b>\n` +
      `Tarama zamanı: <b>${escapeHtml(now)}</b>\n` +
      `Bulunan hisse sayısı: <b>${selected.length}</b>`
    );

    for (const item of selected) {
      const ticker = item.ticker;
      const detailPage = await browser.newPage();

      try {
        await detailPage.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        );

        const detailUrl = DETAIL_URL + encodeURIComponent(ticker);
        await detailPage.goto(detailUrl, {
          waitUntil: "networkidle2",
          timeout: 120000,
        });

        await sleep(2500);

        const detail = await extractDetailData(detailPage, ticker);
        const chartPath = await captureMiniChart(detailPage, ticker);

        const alisNum = toNumber(detail.alis);
        const stopNum = toNumber(detail.stop);
        let riskText = "-";

        if (alisNum && stopNum && alisNum > 0) {
          const risk = ((alisNum - stopNum) / alisNum) * 100;
          riskText = `${risk.toFixed(2)}%`;
        }

        const caption =
          `<b>${escapeHtml(ticker)}</b>\n` +
          `Alış: <b>${escapeHtml(detail.alis || "-")}</b>\n` +
          `Stop: <b>${escapeHtml(detail.stop || "-")}</b>\n` +
          `Risk: <b>${escapeHtml(riskText)}</b>`;

        await telegramSendPhoto(chartPath, caption);
      } catch (err) {
        await telegramSendMessage(
          `<b>${escapeHtml(ticker)}</b>\nGrafik alınamadı.\nHata: <code>${escapeHtml(err.message)}</code>`
        );
      } finally {
        await detailPage.close().catch(() => {});
      }

      await sleep(WAIT_BETWEEN_SYMBOLS);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(async (err) => {
  console.error(err);
  if (TOKEN && CHAT_ID) {
    try {
      await telegramSendMessage(
        `Mini grafik botu hata verdi:\n<code>${escapeHtml(err.message)}</code>`
      );
    } catch {}
  }
  process.exit(1);
});