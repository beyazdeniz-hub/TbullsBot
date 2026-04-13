const axios = require("axios");

async function test() {
  try {
    const res = await axios.get("https://www.alphavantage.co/query", {
      params: {
        function: "TIME_SERIES_DAILY",
        symbol: "THYAO.IST",
        apikey: "T3DAES5QSOIM2T40",
        outputsize: "compact"
      }
    });
    console.log(JSON.stringify(res.data).substring(0, 500));
  } catch (e) {
    console.log("Hata:", e.message);
  }
}

test();
