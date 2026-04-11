const puppeteer = require("puppeteer");
const axios = require("axios");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";

async function main() {
    console.log("Sistem baslatildi...");
    if (!TOKEN || !CHAT_ID) {
        console.error("HATA: TOKEN veya CHAT_ID bulunamadi! GitHub Secrets ayarlarini kontrol edin.");
        return;
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    try {
        const page = await browser.newPage();
        console.log("Sayfaya gidiliyor: " + URL);
        await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

        console.log("Sayfa kaydiriliyor...");
        for (let i = 0; i < 5; i++) {
            await page.evaluate(() => window.scrollBy(0, 1000));
            await new Promise(r => setTimeout(r, 1000));
        }

        const hisseler = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll(".tdName"));
            return items
                .filter(item => item.innerText.includes("AL"))
                .map(item => item.innerText.split('\n')[0].trim());
        });

        console.log("Bulunan hisse sayisi: " + hisseler.length);

        if (hisseler.length > 0) {
            const temizListe = [...new Set(hisseler)];
            const mesaj = "📈 **TBulls AL Veren Hisseler:**\n\n" + temizListe.join(", ");
            await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
                chat_id: CHAT_ID,
                text: mesaj,
                parse_mode: "Markdown"
            });
            console.log("Mesaj Telegram'a gonderildi!");
        } else {
            console.log("AL veren hisse bulunamadi.");
        }
    } catch (error) {
        console.error("CALISMA HATASI: " + error.message);
    } finally {
        await browser.close();
        console.log("Tarayici kapatildi.");
    }
}

main();
