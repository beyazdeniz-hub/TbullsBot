import requests
from bs4 import BeautifulSoup
import os

# Hedef URL
URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB"
bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
chat_id = os.getenv("TELEGRAM_CHAT_ID")

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

def hisseleri_tara():
    try:
        response = requests.get(URL, headers=headers)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Sinyal listesinin bulunduğu ana tablo
        table = soup.find('table', {'id': 'MainContent_GridViewSinyalListesi'})
        if not table:
            return "Tablo bulunamadı. Site yapısı veya URL değişmiş olabilir."

        rows = table.find_all('tr')[1:] # Başlık satırını atla
        al_listesi = []

        for row in rows:
            cols = row.find_all('td')
            if len(cols) > 2:
                hisse_adi = cols[1].get_text(strip=True) # 2. Sütun: Hisse Adı
                sinyal = cols[2].get_text(strip=True).upper() # 3. Sütun: Son Sinyal
                
                # Sadece içinde "AL" geçenleri (AL, YENİ AL vb.) filtrele
                if "AL" in sinyal:
                    al_listesi.append(hisse_adi)

        return al_listesi
    except Exception as e:
        return f"Hata oluştu: {str(e)}"

# İşlemi başlat
hisseler = hisseleri_tara()

if isinstance(hisseler, list):
    if hisseler:
        # Hisseleri alt alta diz
        mesaj = "📈 **GÜNCEL 'AL' VEREN HİSSELER**\n\n" + "\n".join(hisseler)
    else:
        mesaj = "Şu an listede 'AL' veren hisse bulunmuyor."
else:
    mesaj = hisseler

# Telegram'a gönder
requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", 
              data={"chat_id": chat_id, "text": mesaj, "parse_mode": "Markdown"})
