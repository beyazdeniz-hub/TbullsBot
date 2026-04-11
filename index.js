const puppeteer = require("puppeteer");
const axios = require("axios");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB";

async function raporVer(mesaj) {
    try {
        await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: mesaj,
            parse_mode: "Markdown"
        });
    } catch (e) { console.log("Telegram hatası"); }
}

async function main() {
    // 1. Adım: Başlangıç Raporu
    await raporVer("🚀 Tarayıcı başlatıldı, siteye gidiliyor...");

    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36");
        
        await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000)); // Sayfa kendine gelsin

        // 2. Adım: Kaydırma Başladı Raporu
        await raporVer("🔄 Sayfa aşağı kaydırılıyor (Bu işlem 30 sn sürebilir)...");

        // Sayfayı parçalı ve yavaş kaydır (Sitenin veriyi yüklemesi için şart)
        for (let i = 0; i < 15; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await new Promise(r => setTimeout(r, 2000));
        }

        // 3. Adım: Veri Toplama
        const hisseler = await page.evaluate(() => {
            // Sitedeki tüm "hisse adı" ve "sinyal" içeren kutuları topla
            const elements = Array.from(document.querySelectorAll('div, span, td'));
            const list = [];
            
            // Tüm sayfayı tara ve içinde "AL" geçen isimleri ayıkla
            elements.forEach(el => {
                if (el.innerText && el.innerText.includes("AL") && el.className.includes("Name")) {
                    const isim = el.innerText.split('\n')[0].trim();
                    if (isim.length > 1 && isim.length < 10) list.push(isim);
                }
            });
            return list;
        });

        const temizListe = [...new Set(hisseler)].filter(h => h !== "AL");

        if (temizListe.length > 0) {
            const sonuc = "✅ **AL Veren Hisseler Bulundu:**\n\n" + temizListe.join(", ");
            await raporVer(sonuc);
        } else {
            await raporVer("⚠️ Sayfa tarandı ama 'AL' sinyali veren bir isim yakalanamadı. Site yapısı değişmiş veya engellenmiş olabilir.");
        }

    } catch (error) {
        await raporVer("❌ **Sistem Hatası:** " + error.message);
    } finally {
        await browser.close();
    }
}

main();
