import requests
from bs4 import BeautifulSoup
import json

def akademi_fihrist_olustur():
    # Hedef: Candlesticker Boğa Formasyonları
    url = "https://www.candlesticker.com/m/BullishPatterns.aspx?lang=tr"
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    print("NeuroTrade Akademi için veri toplama başladı...")
    
    try:
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            print(f"Hata! Siteye ulaşılamadı. Kod: {response.status_code}")
            return

        soup = BeautifulSoup(response.content, 'html.parser')
        fihrist_verisi = []

        # Sayfadaki formasyon linklerini tek tek buluyoruz
        for link in soup.find_all('a', href=True):
            if 'Pattern.aspx' in link['href']:
                isim = link.text.strip()
                tam_link = "https://www.candlesticker.com/m/" + link['href']
                
                if isim and len(isim) > 2:
                    fihrist_verisi.append({
                        "harf": isim[0].upper(), # A'dan Z'ye sıralama için baş harf
                        "baslik": isim,
                        "detay_url": tam_link,
                        "kategori": "Boğa (Yükseliş)"
                    })

        # Matematikçi titizliğiyle alfabetik sıralama yapıyoruz
        fihrist_verisi = sorted(fihrist_verisi, key=lambda x: x['baslik'])

        # Mevcut signals.json dosyasının üzerine yazarak fihristi kaydediyoruz
        with open('signals.json', 'w', encoding='utf-8') as f:
            json.dump(fihrist_verisi, f, ensure_ascii=False, indent=4)
            
        print(f"İşlem Tamam! {len(fihrist_verisi)} adet formasyon 'signals.json' içine kaydedildi.")

    except Exception as e:
        print(f"Bir aksilik oldu: {e}")

if __name__ == "__main__":
    akademi_fihrist_olustur()
