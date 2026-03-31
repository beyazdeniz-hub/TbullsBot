const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

const DOWNLOAD_DIR = path.join(__dirname, "charts");
const MAX_SYMBOLS = 80;
const WAIT_BETWEEN_SYMBOLS = 1200;

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

function normalizeUrl(src, baseUrl) {
  if (!src) return null;
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return null;
  }
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

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000,
  });
}

async function downloadImage(url, outPath) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 120000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: "https://www.turkishbulls.com/",
    },
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outPath);
    res.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  return outPath;
}

async function autoScrollToBottom(page) {
  let lastHeight = 0;
  let stableCount = 0;

  for (let i = 0; i < 100; i++) {
    const currentHeight = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });

    await sleep(1800);

    if (currentHeight === lastHeight) {
      stableCount++;
    } else {
      stableCount = 0;
      lastHeight = currentHeight;
    }

    if (stableCount >= 4) break;
  }

  await sleep(1000);
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
  } catch {}
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

    return [...new Set(found)];
  });

  return tickers.slice(0, MAX_SYMBOLS);
}

async function findChartImageUrl(page, detailUrl) {
  const result = await page.evaluate((currentUrl) => {
    function absUrl(src) {
      try {
        return new URL(src, currentUrl).href;
      } catch {
        return null;
      }
    }

    const imgs = Array.from(document.querySelectorAll("img"));

    const scored = imgs
      .map((img) => {
        const rect = img.getBoundingClientRect();
        const src = img.getAttribute("src") || "";
        const id = img.getAttribute("id") || "";
        const cls = img.getAttribute("class") || "";
        const alt = img.getAttribute("alt") || "";
        const title = img.getAttribute("title") || "";
        const blob = `${src} ${id} ${cls} ${alt} ${title}`.toLowerCase();

        let score = 0;

        if (blob.includes("chart")) score += 10;
        if (blob.includes("grafik")) score += 10;
        if (blob.includes("signal")) score += 3;
        if (blob.includes("candle")) score += 3;
        if (rect.width >= 250) score += 3;
        if (rect.height >= 180) score += 3;
        if (rect.top > 100 && rect.top < 1400) score += 2;

        return {
          src,
          absSrc: absUrl(src),
          width: rect.width,
          height: rect.height,
          top: rect.top,
          score,
        };
      })
      .filter((x) => x.absSrc && x.width >= 200 && x.height >= 150)
      .sort((a, b) => b.score - a.score);

    return scored[0] || null;
  }, detailUrl);

  return result?.absSrc || null;
}

async function captureChartByScreenshot(page, ticker) {
  ensureDir(DOWNLOAD_DIR);

  const safeTicker = ticker.replace(/[^\w.-]/g, "_");
  const outPath = path.join(DOWNLOAD_DIR, `${safeTicker}.png`);

  const handle = await page.evaluateHandle(() => {
    const imgs = Array.from(document.querySelectorAll("img"));

    const scored = imgs
      .map((img) => {
        const rect = img.getBoundingClientRect();
        const src = img.getAttribute("src") || "";
        const id = img.getAttribute("id") || "";
        const cls = img.getAttribute("class") || "";
        const text = `${src} ${id} ${cls}`.toLowerCase();

        let score = 0;
        if (text.includes("chart")) score += 10;
        if (text.includes("grafik")) score += 10;
        if (rect.width >= 250) score += 3;
        if (rect.height >= 180) score += 3;

        return { img, score, width: rect.width, height: rect.height };
      })
      .filter((x) => x.width >= 200 && x.height >= 150)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.img || null;
  });

  const el = handle.asElement();
  if (!el) return null;

  await el.screenshot({ path: outPath });
  return outPath;
}

async function processTicker(browser, ticker) {
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1400, height: 2400 });

    const detailUrl = `${DETAIL_URL}${encodeURIComponent(ticker)}`;
    await page.goto(detailUrl, {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    await sleep(2500);
    await acceptCookiesIfAny(page);
    await page.evaluate(() => window.scrollTo(0, 250));
    await sleep(1000);

    ensureDir(DOWNLOAD_DIR);
    const safeTicker = ticker.replace(/[^\w.-]/g, "_");
    const outPath = path.join(DOWNLOAD_DIR, `${safeTicker}.png`);

    const imageUrl = await findChartImageUrl(page, detailUrl);

    if (imageUrl) {
      try {
        await downloadImage(imageUrl, outPath);
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 5000) {
          return outPath;
        }
      } catch {}
    }

    return await captureChartByScreenshot(page, ticker);
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  ensureDir(DOWNLOAD_DIR);

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
          await telegramSendMessage(`<b>${escapeHtml(ticker)}</b>\nGrafik resmi alınamadı.`);
        } else {
          await telegramSendPhoto(imagePath, `<b>${escapeHtml(ticker)}</b>`);
        }
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
    } catch {}
  }
  process.exit(1);
});