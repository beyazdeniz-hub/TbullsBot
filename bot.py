import yfinance as yf
import requests

TOKEN = "BURAYA_TELEGRAM_BOT_TOKEN"
CHAT_ID = "BURAYA_CHAT_ID"

def send_telegram(text):
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    data = {
        "chat_id": CHAT_ID,
        "text": text
    }
    requests.post(url, data=data, timeout=30)

def main():
    try:
        data = yf.download("THYAO.IS", period="5d", interval="1d", progress=False)

        if data.empty:
            send_telegram("TbullsBot test: yfinance çalıştı ama veri gelmedi.")
            return

        son_kapanis = data["Close"].dropna().iloc[-1]
        send_telegram(f"TbullsBot test başarılı ✅\nTHYAO.IS son kapanış: {son_kapanis}")

    except Exception as e:
        send_telegram(f"TbullsBot hata verdi ❌\n{str(e)}")

if __name__ == "__main__":
    main()
