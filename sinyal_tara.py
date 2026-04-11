import os
import requests
import re

# Ayarlar
bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
chat_id = os.getenv("TELEGRAM_CHAT_ID")
URL = "https://www.turkishbulls.com/SignalList.aspx?lang=tr&MarketSymbol=IMKB"

def hisseleri_cek():
    headers = {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.turkishbulls.com/'
    }

    session = requests.Session()
    
    try:
        # Sayfaya giriş yap
        response = session.get(URL, headers=headers, timeout=20)
        content = response.text

        # Regex ile HTML içindeki hisse bloklarını ve sinyalleri yakalayalım
        # Bu yöntem sayfa kaydırmaya gerek duymaz, çünkü tüm HTML verisi içinde arama yapar
        pattern = r"NameHeader\">([^<]+).*?Son Sinyal.*?>(AL|YENİ AL)<"
        
        # re.DOTALL ile satır atlamalarını da hesaba katarak tüm sayfayı tararız
        bulunanlar = re.findall(pattern, content, re.DOTALL)
        
        # Sadece isimleri temizleyip listeye ekleyelim
        al_verenler = [hisse[0].strip() for hisse in bulunanlar]
        
        return list(dict.fromkeys(al_verenler)) # Tekrar edenleri sil
        
    except Exception as e:
        return [f"Hata: {str(e)}"]

# Listeyi hazırla
hisseler = hisseleri_cek()

if hisseler and "Hata" not in hisseler[0]:
    mesaj = f"📈 **AL Veren Hisseler ({len(hisseler)} Adet):**\n\n" + ", ".join(hisseler)
else:
    mesaj = "❌ Veri çekilemedi veya 'AL' veren hisse bulunamadı."

# Gönder
requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", 
              data={"chat_id": chat_id, "text": mesaj, "parse_mode": "Markdown"})
