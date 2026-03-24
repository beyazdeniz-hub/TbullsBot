import yfinance as yf
import requests
import pandas as pd

TOKEN = "8669851019:AAEKNYtBGKaRJnfeYgCm8eZZhR8QcuuVzbc"
CHAT_ID = "605922503"

HISSELER = [
    "THYAO.IS",
    "ASELS.IS",
    "GARAN.IS",
    "AKBNK.IS",
    "BIMAS.IS",
    "KCHOL.IS",
    "EREGL.IS",
    "SAHOL.IS",
    "SISE.IS",
    "YKBNK.IS",
]

def send_telegram(text):
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    data = {
        "chat_id": CHAT_ID,
        "text": text
    }
    requests.post(url, data=data, timeout=30)

def ema(series, period):
    return series.ewm(span=period, adjust=False).mean()

def rsi(series, period=14):
    delta = series.diff()

    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()

    rs = avg_gain / avg_loss
    rsi_value = 100 - (100 / (1 + rs))
    return rsi_value

def macd(series):
    ema12 = ema(series, 12)
    ema26 = ema(series, 26)
    macd_line = ema12 - ema26
    signal_line = ema(macd_line, 9)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram

def sinyal_kontrol(hisse):
    try:
        df = yf.download(
            hisse,
            period="6mo",
            interval="1d",
            auto_adjust=True,
            progress=False
        )

        if df.empty or len(df) < 50:
            return None

        close = df["Close"].copy()

        df["EMA9"] = ema(close, 9)
        df["EMA21"] = ema(close, 21)
        df["RSI14"] = rsi(close, 14)

        df["MACD"], df["MACD_SIGNAL"], df["MACD_HIST"] = macd(close)

        df = df.dropna().copy()

        if len(df) < 3:
            return None

        son = df.iloc[-1]
        onceki = df.iloc[-2]

        fiyat = float(son["Close"])
        ema9_son = float(son["EMA9"])
        ema21_son = float(son["EMA21"])
        ema9_onceki = float(onceki["EMA9"])
        ema21_onceki = float(onceki["EMA21"])
        rsi_son = float(son["RSI14"])
        macd_son = float(son["MACD"])
        macd_signal_son = float(son["MACD_SIGNAL"])
        hacim_son = float(son["Volume"])
        hacim_ort = float(df["Volume"].tail(20).mean())

        # AL sinyali şartları
        ema_kesisim = ema9_onceki <= ema21_onceki and ema9_son > ema21_son
        trend_ustu = fiyat > ema9_son and fiyat > ema21_son
        rsi_uygun = 50 <= rsi_son <= 70
        macd_uygun = macd_son > macd_signal_son
        hacim_uygun = hacim_son >= hacim_ort

        if ema_kesisim and trend_ustu and rsi_uygun and macd_uygun and hacim_uygun:
            stop = ema21_son
            risk_yuzde = ((fiyat - stop) / fiyat) * 100 if fiyat > stop else 0
            hedef = fiyat + (fiyat - stop) * 2

            return {
                "hisse": hisse,
                "fiyat": fiyat,
                "stop": stop,
                "hedef": hedef,
                "risk": risk_yuzde,
                "rsi": rsi_son
            }

        return None

    except Exception as e:
        return {
            "hisse": hisse,
            "hata": str(e)
        }

def mesaj_olustur(sonuclar, hatalar):
    if not sonuclar and not hatalar:
        return "TbullsBot\nUygun AL sinyali bulunamadı."

    mesaj = "TbullsBot - yfinance taraması\n\n"

    if sonuclar:
        mesaj += "AL sinyali veren hisseler:\n"
        sonuclar = sorted(sonuclar, key=lambda x: x["risk"])

        for i, s in enumerate(sonuclar, start=1):
            mesaj += (
                f"{i}) {s['hisse']}\n"
                f"Fiyat: {s['fiyat']:.2f}\n"
                f"Stop: {s['stop']:.2f}\n"
                f"Hedef: {s['hedef']:.2f}\n"
                f"Risk %: {s['risk']:.2f}\n"
                f"RSI: {s['rsi']:.2f}\n\n"
            )
    else:
        mesaj += "AL sinyali veren hisse bulunamadı.\n\n"

    if hatalar:
        mesaj += "Hata alınan hisseler:\n"
        for h in hatalar:
            mesaj += f"- {h['hisse']}: {h['hata']}\n"

    return mesaj.strip()

def main():
    sonuclar = []
    hatalar = []

    for hisse in HISSELER:
        sonuc = sinyal_kontrol(hisse)

        if sonuc is None:
            continue

        if "hata" in sonuc:
            hatalar.append(sonuc)
        else:
            sonuclar.append(sonuc)

    mesaj = mesaj_olustur(sonuclar, hatalar)
    send_telegram(mesaj)

if __name__ == "__main__":
    main()
