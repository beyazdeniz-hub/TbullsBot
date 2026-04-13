O zaman grafik muhtemelen <canvas> veya JavaScript ile çiziliyor, normal <img> değil. Bu yüzden selector çalışmıyor.
En güvenilir çözüm — grafiği değil, sayfanın tamamının ekran görüntüsünü almak. Şu bot.js'i kullan:
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
}

function formatTurkeyDateTime() {
  return new Date().toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
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
    const payload = { chat_id: CHAT_ID, text, disable_web_page_preview: true };
    if (html) payload.parse_mode = "HTML";
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, payload, { timeout: 30000 });
  } catch (e) {
    console.log("Telegram mesaj hatası:", e.response?.data || e.message);
  }
}

async function sendTelegramPhoto(photoBuffer, caption) {
  if (!TOKEN || !CHAT_ID) return;
  try {
    const formData = new FormData();
    formData.append("chat_id", CHAT_ID);
    formData.append("caption", caption);
    formData.append("parse_mode", "HTML");
    formData.append("photo", photoBuffer, {
      filename: "chart.png",
      contentType: "image/png",
    });

    await axios.post(
      `https://api.telegram.org/bot${TOKEN}/sendPhoto`,
      formData,
      { headers: formData.getHeaders(), timeout: 60000 }
    );
  } catch (e) {
    console.log("Telegram resim hatası:", e.response?.data || e.message);
  }
}

async function resolveChromePath() {
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), ".cache", "puppeteer");
  const installed = await getInstalledBrowsers({ cacheDir });
  const selected = installed.filter((b) => String(b.browser).toLowerCase().includes("chrome")).pop() || installed.pop();
  if (!selected || !selected.executablePath) throw new Error("Chrome bulunamadı.");
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
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  });
}

async function extractDetailAndChart(detailPage, ticker) {
  await safeGoto(detailPage, `${DETAIL_URL}${ticker}`, "networkidle0");
  await sleep(4000);

  let screenshotBuffer = null;

  try {
    // Sayfanın tamamının ekran görüntüsünü al
    screenshotBuffer = await detailPage.screenshot({
      type: "png",
      fullPage: false, // sadece görünen kısım
      clip: { x: 0, y: 0, width: 1200, height: 800 },
    });
    console.log(`${ticker} sayfa ekran görüntüsü alındı.`);
  } catch (e) {
    console.log(`${ticker} ekran görüntüsü alınamadı: ${e.message}`);
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
        /Alış\s*Seviyesi[:\s]*([0-9.,]+)/i,
        /Alı[şs]\s*Fiyat[ıi][:\s]*([0-9.,]+)/i,
        /Buy\s*Price[:\s]*([0-9.,]+)/i,
        /Al[:\s]*([0-9.,]+)/i,
      ]),
      stoploss: pick([
        /Stoploss[:\s]*([0-9.,]+)/i,
        /Stop\s*Loss[:\s]*([0-9.,]+)/i,
        /Stop[:\s]*([0-9.,]+)/i,
      ]),
    };
  });

  return { ...levels, screenshotBuffer };
}

async function uploadJsonToGithub(remotePath, data, message, retries = 2) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return;

  for (let i = 0; i <= retries; i++) {
    try {
      const content = Buffer.from(JSON.stringify(data, null, 2), "utf8").toString("base64");
      let sha = null;

      try {
        const res = await axios.get(
          `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${remotePath}?ref=${GITHUB_BRANCH}`,
          { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
        );
        sha = res.data.sha;
      } catch (e) {
        // Dosya henüz yok
      }

      await axios.put(
        `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${remotePath}`,
        { message, content, branch: GITHUB_BRANCH, ...(sha ? { sha } : {}) },
        { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
      );

      console.log(`GitHub yükleme başarılı: ${remotePath}`);
      return;
    } catch (e) {
      if (i === retries) {
        console.log(`GitHub yükleme hatası (${remotePath}):`, e.response?.data || e.message);
      } else {
        console.log(`GitHub yükleme yeniden deneniyor (${i + 1}/${retries})...`);
        await sleep(3000);
      }
    }
  }
}

async function run() {
  const chromePath = await resolveChromePath();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1200,800"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 2000 });
    await safeGoto(page, URL, "networkidle2");

    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 2000));
    });

    const tickers = await collectTickers(page);
    console.log(`Toplam ${tickers.length} hisse bulundu.`);

    const detailPage = await browser.newPage();
    await detailPage.setViewport({ width: 1200, height: 800 });

    const results = [];

    // DEBUG: Sadece THYAO ile test et
    const testTickers = ["THYAO"];

    for (const ticker of testTickers) {
      try {
        const detail = await extractDetailAndChart(detailPage, ticker);
        const alisNum = toNumber(detail.alSeviyesi);
        const stopNum = toNumber(detail.stoploss);

        console.log(`${ticker} → Alış: ${detail.alSeviyesi}, Stop: ${detail.stoploss}`);

        if (!isNaN(alisNum) && !isNaN(stopNum) && alisNum > 0) {
          const risk = ((alisNum - stopNum) / alisNum) * 100;
          console.log(`${ticker} → Risk: %${risk.toFixed(2)}`);

          // DEBUG: Risk limitini geç, her zaman gönder
          results.push({ ticker, alis: detail.alSeviyesi, stop: detail.stoploss, risk });

          if (detail.screenshotBuffer) {
            const caption = `<b>#${ticker}</b>\nAlış: ${detail.alSeviyesi}\nStop: ${detail.stoploss}\nRisk: %${risk.toFixed(2)}`;
            await sendTelegramPhoto(detail.screenshotBuffer, caption);
            console.log(`${ticker} Telegram'a gönderildi.`);
            await sleep(1500);
          } else {
            console.log(`${ticker} için screenshot yok, Telegram'a gönderilmedi.`);
          }
        } else {
          console.log(`${ticker} → Sayısal değer alınamadı, atlandı.`);
          // DEBUG: Yine de screenshot varsa gönder
          if (detail.screenshotBuffer) {
            const caption = `<b>#${ticker}</b> (debug - değer alınamadı)`;
            await sendTelegramPhoto(detail.screenshotBuffer, caption);
            console.log(`${ticker} debug screenshot Telegram'a gönderildi.`);
          }
        }
      } catch (e) {
        console.log(`${ticker} işlenirken hata: ${e.message}`);
      }

      await sleep(DETAIL_DELAY_MS);
    }

    results.sort((a, b) => a.risk - b.risk);

    const category = getTimeCategory();
    const updatedAt = formatTurkeyDateTime();
    const payload = {
      updatedAt,
      signals: results.map((r) => ({ ...r, risk: r.risk.toFixed(2) })),
    };

    await uploadJsonToGithub("signals.json", payload, `Update ${updatedAt}`);
    if (category === "seans") await uploadJsonToGithub("seans.json", payload, `Update ${updatedAt}`);
    if (category === "onay") await uploadJsonToGithub("onay.json", payload, `Update ${updatedAt}`);

    await sendTelegram(
      `<b>NeuroTrade İşlemi Tamamlandı</b>\nKategori: ${category}\nBulunan Sinyal: ${results.length}`,
      true
    );

    console.log(`İşlem tamamlandı. Kategori: ${category}, Sinyal: ${results.length}`);
  } finally {
    await browser.close();
  }
}

run().catch((err) => console.log("ANA BOT HATASI:", err.message));
