import requests
from bs4 import BeautifulSoup
import os

# Takip ettiğin hisseler
hisseler = ["PEKGY", "GIPTA", "BIGTK"]
bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
chat_id = os.getenv("TELEGRAM_CHAT_ID")

def sinyal_sorgula(hisse):
    url = f"https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker={hisse}"
    response = requests.get(url)
    soup = BeautifulSoup(response.text, 'html.parser')
    
    # Sitedeki son sinyal kutusunu bulur
    sinyal = soup.find("div", {"id": "MainContent_PanelSignal"}).get_text(strip=True)
    return f"{hisse}: {sinyal}"

sonuc_mesaji = "🚀 Günlük Sinyal Raporu:\n\n"
for h in hisseler:
    try:
        sonuc_mesaji += sinyal_sorgula(h) + "\n"
    except:
        sonuc_mesaji += f"{h}: Veri alınamadı.\n"

# Telegram'a gönder
requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", 
              data={"chat_id": chat_id, "text": sonuc_mesaji})
