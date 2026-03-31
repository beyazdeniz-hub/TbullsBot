const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

const SCREENSHOT_DIR = path.join(__dirname, "charts");
const MAX_SYMBOLS = 80;
const WAIT_BETWEEN_SYMBOLS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function telegramSendMessage(text) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
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
    {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      timeout: 120000,
    }
  );
}

async function autoScrollToBottom(page) {
  let lastHeight = 0;
  let sameCount = 0;

  for (let i = 0; i < 100; i++) {
    const currentHeight = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });

    await sleep(1800);

    if (currentHeight === lastHeight) {
      sameCount++;
    } else {
      sameCount = 0;
      lastHeight = currentHeight;
    }

    if (sameCount >= 4) {
      break;
    }
  }

  await sleep(1000);
}

async function extractTickers(page) {
  const tickers = await page.evaluate(() => {
    const normalizeTicker = (text) =>
      String(text || "")
        .trim()
        .toUpperCase()
        .replace(/Ç/g, "C")
        .replace(/Ğ/g, "G")
        .replace(/İ/g, "I")
        .replace(/Ö/g, "O")
        .replace(/Ş/g, "S")
        .replace(/Ü/g, "U");

    const found = [];

    const links = Array.from(document.querySelectorAll("a"));
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").trim();

      if (/SignalPage\.aspx/i.test(href) || /Ticker=/i.test(href)) {
        let ticker = null;

        const match = href.match(/Ticker=([^&]+)/i);
        if (match && match[1]) {
          ticker = decodeURIComponent(match[1]);
        } else if (/^[A-ZÇĞİÖŞÜ.]{2,10}$/.test(text)) {
          ticker = text;
        }

        ticker = normalizeTicker(ticker);

        if (/^[A-Z.]{2,10}$/.test(ticker)) {
          found.push(ticker);
        }
      }
    }

    const rows = Array.from(document.querySelectorAll("tr"));
    for (const tr of rows) {
      const rowText = tr.innerText.replace(/\s+/g, " ").trim();
      if (!rowText) continue;
      if (!/al/i.test(rowText)) continue;

      const candidates = rowText.match(/\b[A-ZÇĞİÖŞÜ]{2,10}\b/g) || [];
      for (const c of candidates) {
        const ticker = normalizeTicker(c);
        if (/^[A-Z.]{2,10}$/.test(ticker)) {
          found.push(ticker);
        }
      }
    }

    const unique = [];
    const seen = new Set();

    for (const t of found) {
      if (!seen.has(t)) {
        seen.add(t);
        unique.push(t);
      }
    }

    return unique;
  });

  return tickers.slice(0, MAX_SYMBOLS);
}

async function acceptCookiesIfAny(page) {
  const possibleTexts = ["Kabul", "Accept", "Tamam", "I Agree", "Anladım"];

  try {
    const elements = await page.$$("button, a, input[type='button'], input[type='submit']");
    for (const el of elements) {
      const value = await page.evaluate((node) => {
        return (node.innerText || node.textContent || node.value || "").trim();
      }, el);

      if (possibleTexts.some((t) => value.toLowerCase() === t.toLowerCase())) {
        await el.click().catch(() => {});
        await sleep(1000);
        break;
      }
    }
  } catch (_) {}
}

async function closeBottomAdsIfAny(page) {
  const possibleSelectors = [
    "div[style*='position: fixed'] .close",
    "div[style*='position:fixed'] .close",
    "div[style*='position: fixed'] button",
    "div[style*='position:fixed'] button",
    "div[style*='position: fixed'] a",
    "div[style*='position:fixed'] a",
  ];

  for (const selector of possibleSelectors) {
    try {
      const list = await page.$$(selector);
      for (const el of list) {
        const text = await page.evaluate((node) => {
          return (node.innerText || node.textContent || "").trim();
        }, el);

        if (["×", "x", "X", "Kapat", "Close"].includes(text)) {
          await el.click().catch(() => {});
          await sleep(800);
          return;
        }
      }
    } catch (_) {}
  }

  try {
    await page.evaluate(() => {
      const fixeds = Array.from(document.querySelectorAll("*")).filter((el) => {
        const s = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          s.position === "fixed" &&
          rect.height > 40 &&
          rect.width > 100 &&
          rect.bottom >= window.innerHeight - 5
        );
      });

      fixeds.forEach((el) => {
        el.style.display = "none";
      });
    });
  } catch (_) {}
}

async function hideNoise(page) {
  try {
    await page.evaluate(() => {
      const hideByText = ["reklam", "advertisement", "sponsor"];
      const all = Array.from(document.querySelectorAll("div, iframe, ins, aside"));

      for (const el of all) {
        const txt = (el.innerText || "").toLowerCase();
        if (hideByText.some((t) => txt.includes(t))) {
          el.style.display = "none";
        }
      }

      const possible = document.querySelectorAll("iframe, ins");
      possible.forEach((el) => {
        el.style.display = "none";
      });
    });
  } catch (_) {}
}

async function findMainChartElement(page) {
  const selectors = [
    "img[src*='chart']",
    "img[src*='Chart']",
    "img[id*='chart']",
    "img[id*='Chart']",
    "canvas",
    "#ContentPlaceHolder1_Image1",
    "#ContentPlaceHolder1_imgChart",
  ];

  for (const selector of selectors) {
    try {
      const elements = await page.$$(selector);

      for (const el of elements) {
        const box = await el.boundingBox();
        if (!box) continue;
        if (box.width < 250 || box.height < 180) continue;

        return el;
      }
    } catch (_) {}
  }

  try {
    const handle = await page.evaluateHandle(() => {
      const elements = Array.from(document.querySelectorAll("img, canvas"));

      const scored = elements
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const src = (el.getAttribute && el.getAttribute("src")) || "";
          const id = (el.getAttribute && el.getAttribute("id")) || "";
          const cls = (el.getAttribute && el.getAttribute("class")) || "";
          const text = `${src} ${id} ${cls}`.toLowerCase();

          let score = 0;

          if (text.includes("chart")) score += 10;
          if (text.includes("grafik")) score += 10;
          if (el.tagName.toLowerCase() === "canvas") score += 3;
          if (rect.width >= 300) score += 3;
          if (rect.height >= 200) score += 3;

          return {
            el,
            score,
            width: rect.width,
            height: rect.height,
            top: rect.top,
          };
        })
        .filter((x) => x.width >= 250 && x.height >= 180 && x.top > 50)
        .sort((a, b) => b.score - a.score);

      return scored[0]?.el || null;
    });

    const el = handle.asElement();
    if (el) return el;
  } catch (_) {}

  return null;
}

async function captureMainChart(page, ticker) {
  ensureDir(SCREENSHOT_DIR);

  const safeTicker = ticker.replace(/[^\w.-]/g, "_");
  const outPath = path.join(SCREENSHOT_DIR, `${safeTicker}.png`);

  const chartEl = await findMainChartElement(page);
  if (!chartEl) return null;

  const box = await chartEl.boundingBox();
  if (!box) return null;

  const clip = {
    x: Math.max(0, Math.floor(box.x - 8)),
    y: Math.max(0, Math.floor(box.y - 8)),
    width: Math.floor(box.width + 16),
    height: Math.floor(box.height + 16),
  };

  await page.screenshot({
    path: outPath,
    clip,
  });

  return outPath;
}

async function processTicker(browser, ticker) {
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    await page.setViewport({ width: 1400, height: 2400 });

    const url = `${DETAIL_URL}${encodeURIComponent(ticker)}`;
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    await sleep(2500);
    await acceptCookiesIfAny(page);
    await closeBottomAdsIfAny(page);
    await hideNoise(page);

    await page.evaluate(() => window.scrollTo(0, 250));
    await sleep(1000);

    const imagePath = await captureMainChart(page, ticker);
    return imagePath;
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  ensureDir(SCREENSHOT_DIR);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1400, height: 2400 },
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    await page.goto(URL, {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    await sleep(3000);
    await acceptCookiesIfAny(page);
    await autoScrollToBottom(page);

    const tickers = await extractTickers(page);

    if (!tickers.length) {
      await telegramSendMessage("Hiç hisse bulunamadı.");
      return;
    }

    const now = new Date().toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
    });

    await telegramSendMessage(
      `<b>Turkishbulls Grafik Taraması</b>\n` +
      `Tarama zamanı: <b>${escapeHtml(now)}</b>\n` +
      `Bulunan hisse: <b>${tickers.length}</b>`
    );

    for (const ticker of tickers) {
      try {
        const imagePath = await processTicker(browser, ticker);

        if (!imagePath || !fs.existsSync(imagePath)) {
          await telegramSendMessage(
            `<b>${escapeHtml(ticker)}</b>\nGrafik alanı bulunamadı.`
          );
          await sleep(WAIT_BETWEEN_SYMBOLS);
          continue;
        }

        await telegramSendPhoto(imagePath, `<b>${escapeHtml(ticker)}</b>`);
      } catch (err) {
        await telegramSendMessage(
          `<b>${escapeHtml(ticker)}</b>\nHata: <code>${escapeHtml(err.message || String(err))}</code>`
        );
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
        `Bot hata verdi:\n<code>${escapeHtml(err.message || String(err))}</code>`
      );
    } catch (_) {}
  }
  process.exit(1);
});