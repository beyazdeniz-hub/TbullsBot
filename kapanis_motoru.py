import os
import json
import requests
import yfinance as yf
from datetime import datetime

# GitHub'daki history.json dosyanızın yerel (local) yolu
HISTORY_FILE_PATH = "history.json" 

def canli_fiyatlari_ve_marjlari_guncelle():
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Kapanış Motoru Tetiklendi...")
    
    # 1. history.json dosyasını güvenle açalım
    if not os.path.exists(HISTORY_FILE_PATH):
        print(f"Hata: {HISTORY_FILE_PATH} dosyası bulunamadı!")
        return

    with open(HISTORY_FILE_PATH, 'r', encoding='utf-8') as f:
        try:
            history_data = json.load(f)
        except Exception as e:
            print(f"JSON okuma hatası: {e}")
            return

    # 2. Matematiksel Küme (Set) Mantığı: Tekrar eden tüm hisseleri otomatik teke düşürür
    tum_hisseler = set()
    for tarih in history_data:
        if "signals" in history_data[tarih]:
            for sig in history_data[tarih]["signals"]:
                if "ticker" in sig and sig["ticker"]:
                    tum_hisseler.add(sig["ticker"].upper().strip())
    
    if not tum_hisseler:
        print("Geçmişte güncellenecek hiç hisse kaydı bulunamadı.")
        return

    print(f"Arşivde toplam {len(tum_hisseler)} adet benzersiz hisse tespit edildi. Fiyatlar çekiliyor...")

    # 3. Yahoo Finance için toplu sembol listesi hazırlama (.IS uzantılı)
    yf_sembolleri = [f"{hisse}.IS" for hisse in tum_hisseler]
    
    try:
        # Tüm hisselerin verilerini tek bir istekte indirerek iş yükünü sıfıra indiriyoruz
        canli_veriler = yf.download(yf_sembolleri, period="1d", group_by="ticker", progress=False)
        
        guncel_fiyatlar = {}
        for hisse in tum_hisseler:
            sembol = f"{hisse}.IS"
            if sembol in canli_veriler.columns.levels[0]:
                try:
                    son_kapanis = canli_veriler[sembol]['Close'].iloc[-1]
                    # Fiyatın geçerli bir sayı olduğunu kontrol et
                    if son_kapanis and not float('-inf') < son_kapanis < float('inf'):
                        guncel_fiyatlar[hisse] = round(float(son_kapanis), 2)
                except:
                    continue

        print(f"Yahoo Finance üzerinden {len(guncel_fiyatlar)} hissenin anlık kapanış fiyatı başarıyla alındı.")

        # 4. Tüm arşivi taze seans kapanış fiyatlarıyla yeniden hesaplayıp dolduruyoruz
        for tarih in history_data:
            total_margin = 0
            valid_signal_count = 0
            
            if "signals" in history_data[tarih]:
                for sig in history_data[tarih]["signals"]:
                    hisse_kodu = sig.get("ticker", "").upper().strip()
                    alis_fiyati = float(sig.get("alis", 0))
                    
                    if hisse_kodu in guncel_fiyatlar and alis_fiyati > 0:
                        canli_fiyat = guncel_fiyatlar[hisse_kodu]
                        
                        # Matematiksel Değişim Formülü: ((Kapanış - Alış) / Alış) * 100
                        yuzde_degisim = ((canli_fiyat - alis_fiyati) / alis_fiyati) * 100
                        
                        # Uygulama ekranlarındaki tüm alanları kalıcı olarak besliyoruz
                        sig["current"] = canli_fiyat
                        sig["change"] = f"{yuzde_degisim:.2f}"
                        sig["margin"] = f"{yuzde_degisim:.2f}"
                        
                        total_margin += yuzde_degisim
                        valid_signal_count += 1
            
            # Ana menüdeki tarih kartlarının üzerinde yazan Ortalama Marjı hesapla
            if valid_signal_count > 0:
                history_data[tarih]["avgMargin"] = f"{(total_margin / valid_signal_count):.2f}"
            else:
                history_data[tarih]["avgMargin"] = "0.00"

        # 5. Güncellenmiş verileri history.json üzerine tamamen yazıyoruz
        with open(HISTORY_FILE_PATH, 'w', encoding='utf-8') as f:
            json.dump(history_data, f, ensure_ascii=False, indent=4)
            
        print("Mükemmel! history.json dosyası güncel marjlarla tamamen yenilendi.")

    except Exception as e:
        print(f"Kapanış motoru çalışırken genel hata: {e}")

if __name__ == "__main__":
    canli_fiyatlari_ve_marjlari_guncelle()
