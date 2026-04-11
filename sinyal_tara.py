import requests
from bs4 import BeautifulSoup
import os

# Ayarlar
URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB"
bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
chat_id = os.getenv("TELEGRAM_CHAT_ID")

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

def sinyalleri_getir():
    response = requests.get(URL, headers=headers)
    soup = BeautifulSoup(response.text, 'html.parser')
    
    # Tabloyu bul (TurkishBulls'un ana sinyal tablosu)
    table = soup.find('table', {'id': 'MainContent_GridViewSinyalListesi'})
    if not table:
        return "Tablo bulunamadı, site yapısı değişmiş olabilir."

    rows = table.find_all('tr')[1:] # Başlığı atla
    al_verenler = []

    for row in rows:
        cols = row.find_all('td')
        if len(cols) > 5:
            hisse_adi = cols[1].text.strip()
            son_sinyal = cols[2].text.strip()
            al_seviyesi = cols[4].text.strip() # Al Seviyesi sütunu
            
            # Sinyal "AL" ise listeye ekle
            if "AL" in son_sinyal.upper():
                # Stop seviyesi genellikle Turkishbulls'ta formülseldir 
                # (Basitçe Al seviyesinin %2-3 altını stop olarak hesaplayabiliriz veya siteden çekebiliriz)
                try:
                    stop_fiyat = float(al_seviyesi.replace(',', '.')) * 0.97 # %3 Stop örneği
                    stop_str = f"{stop_fiyat:.2f}"
                except:
                    stop_str = "Hesaplanamadı"
                
                al_verenler.append(f"✅ **{hisse_adi}**\n   Sinyal: {son_sinyal}\n   Giriş: {al_seviyesi}\n   Stop: {stop_str}")

    return al_verenler

# Sonuçları hazırla ve gönder
sinyal_listesi = sinyalleri_getir()

if isinstance(sinyal_listesi, list):
    if not sinyal_listesi:
        mesaj = "Bugün 'AL' veren yeni bir hisse bulunamadı."
    else:
        # Mesaj çok uzun olursa Telegram reddedebilir, o yüzden 10'arlı gruplar halinde gönderelim
        mesaj = "📊 **TurkishBulls AL Veren Hisseler**\n\n" + "\n\n".join(sinyal_listesi[:15])
else:
    mesaj = sinyal_listesi

requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", 
              data={"chat_id": chat_id, "text": mesaj, "parse_mode": "Markdown"})
