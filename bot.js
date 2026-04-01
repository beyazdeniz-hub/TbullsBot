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

async function telegramMesajGonder(text) {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
  });
}

async function telegramResimGonder(filePath, caption = "") {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("caption", caption);
  form.append("photo", fs.createReadStream(filePath));

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });
}

async function listeyiAsagiKaydir(page) {
  let oncekiYukseklik = 0;
  let ayniSayac = 0;

  for (let i = 0; i < 25; i++) {
    const yukseklik = await page.evaluate(() => {
      return Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
    });

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await sleep(1800);

    const yeniYukseklik = await page.evaluate(() => {
      return Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
    });

    if (yeniYukseklik === oncekiYukseklik) {
      ayniSayac++;
    } else {
      ayniSayac = 0;
    }

    oncekiYukseklik = yeniYukseklik;

    if (ayniSayac >= 3) {
      break;
    }
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });

  await sleep(1500);
}

async function ilkHisseyiBul(page) {
  await page.goto(LIST_URL, {
    waitUntil: "networkidle2",
    timeout: 90000,
  });

  await sleep(4000);
  await listeyiAsagiKaydir(page);

  const ticker = await page.evaluate(() => {
    const textler = Array.from(document.querySelectorAll("a, td, span, div"))
      .map((el) => (el.innerText || "").trim())
      .filter(Boolean);

    const adaylar = [];

    for (const t of textler) {
      const temiz = t.replace(/[^A-ZÇĞİÖŞÜ]/g, "");
      if (/^[A-ZÇĞİÖŞÜ]{3,6}$/.test(temiz)) {
        adaylar.push(temiz);
      }
    }

    const blacklist = new Set([
      "AL",
      "SAT",
      "SON",
      "GUN",
      "GÜN",
      "HAFTA",
      "AY",
      "YIL",
      "BIST",
      "IMKB",
      "XU100",
      "TL",
    ]);

    const filtreli = adaylar.filter((x) => !blacklist.has(x));
    return filtreli[0] || null;
  });

  return ticker;
}

async function grafikElementiniBul(page) {
  const selectors = [
    "img",
    "svg",
    "canvas",
    "object",
    "embed"
  ];

  for (const selector of selectors) {
    const elements = await page.$$(selector);

    for (const el of elements) {
      try {
        const box = await el.boundingBox();
        if (!box) continue;

        if (box.width < 450 || box.height < 250) continue;

        const info = await page.evaluate((node) => {
          const tag = node.tagName.toLowerCase();
          const src =
            node.getAttribute("src") ||
            node.getAttribute("data") ||
            node.getAttribute("href") ||
            "";
          const text = (node.innerText || "").trim();

          const rect = node.getBoundingClientRect();
          const parentText = node.parentElement
            ? (node.parentElement.innerText || "").trim()
            : "";

          return {
            tag,
            src: String(src).toLowerCase(),
            text: text.toLowerCase(),
            parentText: parentText.toLowerCase(),
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          };
        }, el);

        const alanMetni = `${info.src} ${info.text} ${info.parentText}`;

        const gucluEslesme =
          alanMetni.includes("chart") ||
          alanMetni.includes("graph") ||
          alanMetni.includes("signal") ||
          alanMetni.includes("cand") ||
          alanMetni.includes("alış") ||
          alanMetni.includes("alis") ||
          alanMetni.includes("stop") ||
          alanMetni.includes("loss") ||
          alanMetni.includes("seviyesi");

        if (gucluEslesme) {
          return el;
        }
      } catch (e) {}
    }
  }

  const buyukKutular = await page.$$("*");

  for (const el of buyukKutular) {
    try {
      const box = await el.boundingBox();
      if (!box) continue;

      if (box.width < 500 || box.height < 300) continue;
      if (box.width > 1300 || box.height > 1200) continue;

      const text = await page.evaluate((node) => {
        const txt = (node.innerText || "").toLowerCase();
        return txt.slice(0, 1500);
      }, el);

      if (
        text.includes("alış") ||
        text.includes("alis") ||
        text.includes("stop") ||
        text.includes("stoploss") ||
        text.includes("seviyesi")
      ) {
        return el;
      }
    } catch (e) {}
  }

  return null;
}

async function grafikGoruntusuAl(page, ticker) {
  const detailUrl = `${DETAIL_URL}${ticker}`;

  await page.goto(detailUrl, {
    waitUntil: "networkidle2",
    timeout: 90000,
  });

  await sleep(5000);

  await page.setViewport({
    width: 1400,
    height: 2200,
    deviceScaleFactor: 1,
  });

  await page.evaluate(() => {
    window.scrollTo(0, 250);
  });

  await sleep(2000);

  let grafikEl = await grafikElementiniBul(page);

  if (!grafikEl) {
    await page.evaluate(() => {
      window.scrollTo(0, 500);
    });
    await sleep(2000);
    grafikEl = await grafikElementiniBul(page);
  }

  if (!grafikEl) {
    const fullPath = `tum_sayfa_${ticker}.png`;
    await page.screenshot({ path: fullPath, fullPage: true });
    throw new Error(`Grafik bulunamadı. Kontrol resmi oluşturuldu: ${fullPath}`);
  }

  const filePath = `grafik_${ticker}.png`;
  await grafikEl.screenshot({ path: filePath });

  return {
    filePath,
    detailUrl,
  };
}

async function main() {
  let browser;

  try {
    if (!TOKEN || !CHAT_ID) {
      throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID tanımlı değil.");
    }

    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
      defaultViewport: {
        width: 1400,
        height: 2200,
      },
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    await page.setExtraHTTPHeaders({
      "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    const ticker = await ilkHisseyiBul(page);

    if (!ticker) {
      throw new Error("AL listesinden hisse bulunamadı.");
    }

    await telegramMesajGonder(`İlk hisse bulundu: ${ticker}\nDetay sayfasından grafik alınıyor...`);

    const { filePath, detailUrl } = await grafikGoruntusuAl(page, ticker);

    await telegramResimGonder(
      filePath,
      `${ticker} grafik görüntüsü\n${detailUrl}`
    );

    console.log("İşlem tamamlandı:", ticker, filePath);
  } catch (error) {
    console.error("HATA:", error.message);
    try {
      await telegramMesajGonder(`Bot hatası:\n${error.message}`);
    } catch (e) {
      console.error("Telegram hata bildirimi de gönderilemedi:", e.message);
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();