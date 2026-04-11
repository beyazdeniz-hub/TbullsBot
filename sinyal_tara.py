import os
import asyncio
from playwright.async_api import async_playwright
import requests

# Ayarlar
bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
chat_id = os.getenv("TELEGRAM_CHAT_ID")
URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB"

async def hisseleri_topla():
    async with async_playwright() as p:
        # Tarayıcıyı başlat (iPhone simülasyonu ile)
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1")
        page = await context.new_page()
        
        print("Sayfaya gidiliyor...")
        await page.goto(URL, wait_until="networkidle")
        await asyncio.sleep(3) # İlk yükleme için bekle

        # Gerçek kişi gibi aşağı kaydırma döngüsü
        print("Sayfa aşağı kaydırılıyor...")
        for i in range(15): # 15 kez aşağı kaydır (Tüm listeyi kapsar)
            await page.mouse.wheel(0, 2000)
            await asyncio.sleep(1) # Verilerin gelmesini bekle

        # Tüm hisse kartlarını bul
        # Kart yapısındaki isimleri ve sinyalleri çek
        kartlar = await page.query_selector_all(".tdName")
        al_listesi = []

        for kart in kartlar:
            text = await kart.inner_text()
            # Örn: "ADESE\nSon Sinyal\nAL" şeklinde bir metin gelir
            if "AL" in text.upper():
                hisse_adi = text.split('\n')[0].strip()
                al_listesi.append(hisse_adi)

        await browser.close()
        return list(set(al_listesi)) # Tekrar edenleri temizle

def mesaj_gonder(liste):
    if liste:
        son_mesaj = f"📈 **AL Veren Hisseler ({len(liste)} Adet):**\n\n" + ", ".join(sorted(liste))
    else:
        son_mesaj = "❌ Sayfa kaydırıldı ama 'AL' veren hisse bulunamadı."
    
    requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", 
                  data={"chat_id": chat_id, "text": son_mesaj, "parse_mode": "Markdown"})

if __name__ == "__main__":
    hisseler = asyncio.run(hisseleri_topla())
    mesaj_gonder(hisseler)
