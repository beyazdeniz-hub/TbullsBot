import requests
from bs4 import BeautifulSoup
import json

def akademi_fihrist_olustur():
    # Hedef: Candlesticker Boğa Formasyonları (Yükseliş)
    url = "https://www.candlesticker.com/m/BullishPatterns.aspx?lang=tr"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    
    print("NeuroTrade Akademi için veri toplama motoru çalıştı...")
    
    try:
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            print(f"Hata: Siteye erişilemedi. Durum kodu: {response.status_code}")
            return

        soup = BeautifulSoup(response.content, 'html.parser')
        fihrist_verisi = []

        # Sitedeki formasyon linklerini ayıklıyoruz
        for link in soup.find_all('a', href=True):
            if 'Pattern.aspx' in link['href']:
                isim = link.text.strip()
                tam_link = "https://www.candlesticker.com/m/" + link['href']
                
                if isim and len(isim) > 2:
                    fihrist_verisi.append({
                        "harf": isim[0].upper(), # A'dan Z'ye rehber için
                        "baslik": isim,
                        "detay_url": tam_link,
                        "kategori": "Boğa (Yükseliş)"
                    })

        # Matematikçi disipliniyle alfabetik sıralıyoruz
        fihrist_verisi = sorted(fihrist_verisi, key=lambda x: x['baslik'])

        # Sonucu fihrist.json olarak kaydediyoruz
        with open('fihrist.json', 'w', encoding='utf-8') as f:
            json.dump(fihrist_verisi, f, ensure_ascii=False, indent=4)
            
        print(f"Başarılı! {len(fihrist_verisi)} adet formasyon 'fihrist.json' içine döküldü.")

    except Exception as e:
        print(f"Sistem Hatası: {e}")

if __name__ == "__main__":
    akademi_fihrist_olustur()
