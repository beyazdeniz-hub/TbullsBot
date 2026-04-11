import requests
from bs4 import BeautifulSoup
import os

hisseler = ["PEKGY", "GIPTA", "BIGTK"]
bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
chat_id = os.getenv("TELEGRAM_CHAT_ID")

# Kendimizi gerçek bir tarayıcı gibi tanıtıyoruz (Engeli aşmak için)
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, '
                  ' audition/537.36 Chrome/91.0.4472.124 Safari/537.36'
}

def sinyal_sorgula(hisse):
    url = f"https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker={hisse}"
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        soup = BeautifulSoup(response.text, 'html.parser')
        # Sitedeki spesifik sinyal metnini bulur
        sinyal_div = soup.find("div", {"id": "MainContent_PanelSignal"})
        if sinyal_div:
            return sinyal_div.get_text(strip=True)
    return "Veri çekilemedi"

mesaj_listesi = []
for h in hisseler:
    durum = sinyal_sorgula(h)
    mesaj_listesi.append(f"🔍 **{h}**: {durum}")

# Telegram'a şık bir mesaj gönder
son_mesaj = "📊 **TBullsBot Günlük Analiz**\n\n" + "\n".join(mesaj_listesi)
requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", 
              data={"chat_id": chat_id, "text": son_mesaj, "parse_mode": "Markdown"})
