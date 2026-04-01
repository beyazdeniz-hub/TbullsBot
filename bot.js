const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const LIST_URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";
const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTelegramPhoto(filePath, caption = "") {
  const FormData = require("form-data");
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("caption", caption);
  form.append("photo", fs.createReadStream(filePath));

  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });
}

async function sendTelegramMessage(text) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
  });
}

async function autoScrollToBottom(page) {
  let lastHeight = 0;
  let stableCount = 0;

  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 1.5);
    });

    await sleep(1200);

    const info = await page.evaluate(() => {
      return {
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        bodyHeight: document.body.scrollHeight,
      };
    });

    if (info.bodyHeight === lastHeight) {
      stableCount++;
    } else {
      stableCount = 0;
      lastHeight = info.bodyHeight;
    }

    if (stableCount >= 4) break;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1200);
}

async function getFirstTicker(page) {
  const ticker = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a[href*='SignalPage.aspx?lang=tr&Ticker=']"));
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/Ticker=([^&]+)/i);
      if (m && m[1]) return m[1].trim().toUpperCase();
    }
    return null;
  });

  return ticker;
}

async function closePopups(page) {
  const texts = [
    "Kabul",
    "Accept",
    "Tamam",
    "Anladım",
    "Got it",
    "Close",
    "Kapat"
  ];

  try {
    const buttons = await page.$$("button, a, div[role='button']");
    for (const btn of buttons) {
      try {
        const txt = await page.evaluate(el => (el.innerText || "").trim(), btn);
        if (texts.some(t => txt.includes(t))) {
          await btn.click().catch(() => {});
          await sleep(500);
        }
      } catch {}
    }
  } catch {}
}

async function main() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.");
  }

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: 1600,
      height: 1200,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    await sendTelegramMessage("Liste açılıyor...");
    await page.goto(LIST_URL, { waitUntil: "networkidle2", timeout: 120000 });
    await sleep(3000);

    await closePopups(page);
    await autoScrollToBottom(page);

    const firstTicker = await getFirstTicker(page);

    if (!firstTicker) {
      await page.screenshot({ path: "liste_hata.png", fullPage: true });
      await sendTelegramPhoto("liste_hata.png", "İlk hisse bulunamadı.");
      throw new Error("İlk ticker bulunamadı.");
    }

    await sendTelegramMessage(`İlk hisse bulundu: ${firstTicker}`);

    const detailPage = await browser.newPage();

    await detailPage.setViewport({
      width: 1600,
      height: 1200,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });

    await detailPage.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    const detailUrl = DETAIL_URL + encodeURIComponent(firstTicker);

    await detailPage.goto(detailUrl, { waitUntil: "networkidle2", timeout: 120000 });
    await sleep(5000);
    await closePopups(detailPage);
    await sleep(1500);

    // Önce tam ekran görüntüsü
    const fullPath = "detail_full.png";
    await detailPage.screenshot({ path: fullPath, fullPage: true });
    await sendTelegramPhoto(fullPath, `${firstTicker} detay sayfası tam ekran`);

    // BURASI KRİTİK:
    // Daha önce kestiği alanı komple yukarı taşıyoruz.
    // Yükseklik aynı kalıyor, sadece y küçülüyor.
    //
    // Eski mantık örneği:
    // y = 430
    // height = 320
    //
    // Yeni mantık:
    // y = 350   -> 80 px yukarı taşındı
    // height = 320
    //
    // Böylece hem üst hem alt koordinat yukarı kaymış olur.
    const clipX = 130;
    const clipY = 350;   // ESKİYE GÖRE YUKARI ALINDI
    const clipWidth = 900;
    const clipHeight = 320; // AYNI TUTULDU

    const viewport = detailPage.viewport();
    const pageSize = await detailPage.evaluate(() => ({
      bodyWidth: Math.max(
        document.body.scrollWidth,
        document.documentElement.scrollWidth
      ),
      bodyHeight: Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      ),
    }));

    const safeX = Math.max(0, clipX);
    const safeY = Math.max(0, clipY);
    const maxWidth = Math.min(
      clipWidth,
      Math.max(0, (viewport?.width || 1600) - safeX),
      Math.max(0, pageSize.bodyWidth - safeX)
    );
    const maxHeight = Math.min(
      clipHeight,
      Math.max(0, pageSize.bodyHeight - safeY)
    );

    if (maxWidth < 50 || maxHeight < 50) {
      await sendTelegramMessage(
        `Kırpma alanı geçersiz oldu.\nX:${safeX} Y:${safeY} W:${maxWidth} H:${maxHeight}`
      );
      throw new Error("Kırpma alanı geçersiz.");
    }

    const cropPath = "detail_crop.png";

    await detailPage.screenshot({
      path: cropPath,
      clip: {
        x: safeX,
        y: safeY,
        width: maxWidth,
        height: maxHeight,
      },
    });

    await sendTelegramPhoto(
      cropPath,
      `${firstTicker} kırpılmış görüntü\nX:${safeX} Y:${safeY} W:${maxWidth} H:${maxHeight}`
    );

    await sendTelegramMessage("Bitti.");
    await detailPage.close();
  } catch (err) {
    console.error(err);
    try {
      await sendTelegramMessage(`Hata: ${err.message}`);
    } catch {}
    throw err;
  } finally {
    await browser.close();
  }
}

main();