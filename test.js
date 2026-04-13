console.log("BASLADI");
const axios = require("axios");
console.log("AXIOS YUKLENDI");

async function test() {
  console.log("FONKSIYON BASLADI");
  try {
    const res = await axios.get("https://query1.finance.yahoo.com/v8/finance/chart/THYAO.IS", {
      params: { interval: "1d", range: "3mo" },
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });
    console.log("BASARILI");
    console.log(JSON.stringify(res.data).substring(0, 300));
  } catch (e) {
    console.log("HATA:", e.message);
  }
}

test().then(() => console.log("BITTI"));
