const axios = require("axios");

async function test() {
  try {
    const res = await axios.get(
      "https://query1.finance.yahoo.com/v8/finance/chart/THYAO.IS",
      {
        params: {
          interval: "1d",
          range: "3mo"
        },
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      }
    );
    const data = res.data;
    const timestamps = data.chart.result[0].timestamp;
    const ohlcv = data.chart.result[0].indicators.quote[0];
    console.log("Toplam bar:", timestamps.length);
    console.log("Son kapanış:", ohlcv.close[ohlcv.close.length - 1]);
    console.log("BASARILI");
  } catch (e) {
    console.log("Hata:", e.message);
    console.log(e.response?.data);
  }
}

test();
