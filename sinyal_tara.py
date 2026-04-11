import os
import time
import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

# GitHub Secrets
bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
chat_id = os.getenv("TELEGRAM_CHAT_ID")
URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB"

def hisseleri_topla():
    # Tarayıcı ayarları (GitHub Actions uyumlu)
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    driver = webdriver.Chrome(options=chrome_options)

    try:
        driver.get(URL)
        time.sleep(5) # Sayfanın yüklenmesini bekle

        # Sayfayı en aşağıya kadar kaydır (Gerçek kişi simülasyonu)
        last_height = driver.execute_script("return document.body.scrollHeight")
        while True:
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(2) # Yeni kartların yüklenmesi için bekle
            new_height = driver.execute_script("return document.body.scrollHeight")
            if new_height == last_height:
                break
            last_height = new_height

        # Yüklenen tüm hisse bloklarını bul
        hisse_kartlari = driver.find_elements(By.CLASS_NAME, "tdName")
        al_verenler = []

        for kart in hisse_kartlari:
            # Kartın içindeki metni kontrol et (Hisse adı ve Sinyal)
            # Yapı: ADESE Son Sinyal AL
            text = kart.text
            if "AL" in text:
                hisse_adi = text.split('\n')[0] # İlk satır hisse adıdır
                al_verenler.append(hisse_adi)

        return list(set(al_verenler)) # Tekrar edenleri temizle
    finally:
        driver.quit()

# Çalıştır ve Gönder
liste = hisseleri_topla()
if liste:
    mesaj = "📈 **AL Veren Hisseler (Tüm Liste):**\n\n" + ", ".join(sorted(liste))
else:
    mesaj = "AL veren hisse bulunamadı veya sayfa yüklenemedi."

requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", 
              data={"chat_id": chat_id, "text": mesaj, "parse_mode": "Markdown"})
