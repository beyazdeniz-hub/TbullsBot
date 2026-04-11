const puppeteer = require("puppeteer");
const axios = require("axios");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";

async function main() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error("TOKEN veya CHAT_ID eksik!");
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    console.log("Sayfaya gidiliyor...");
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Sayfayı 10 kez aşağı kaydır (Gerçek kişi gibi verileri yükletir)
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, 1500));
      await new Promise(r => setTimeout(r, 1500));
    }

    // "AL" veren hisselerin isimlerini topla
    const hisseler = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".tdName"));
      return items
        .filter(item => item.innerText.includes("AL"))
        .map(item => item.innerText.split('\n')[0].trim());
    });

    const temizListe = [...new Set(hisseler)]; // Tekrar edenleri temizle

    if (temizListe.length > 0) {
      const mesaj = "📈 **TBulls AL Veren Hisseler:**\n\n" + temizListe.join(", ");
      await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        chat_id: CHAT_ID,
        text: mesaj,
        parse_mode: "Markdown"
      });
      console.log("Liste gönderildi!");
    } else {
      console.log("AL veren hisse bulunamadı.");
    }

  } catch (error) {
    console.error("Hata:", error.message);
  } finally {
    await browser.close();
  }
}

main();
