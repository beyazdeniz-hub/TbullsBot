const axios = require("axios");

async function test(symbol) {
  try {
    const res = await axios.get("https://www.alphavantage.co/query", {
      params: {
        function: "TIME_SERIES_DAILY",
        symbol: symbol,
        apikey: "T3DAES5QSOIM2T40",
        outputsize: "compact"
      }
    });
    console.log(symbol + ":", JSON.stringify(res.data).substring(0, 200));
  } catch (e) {
    console.log(symbol + " hata:", e.message);
  }
}

async function run() {
  await test("THYAO.IST");
  await test("THYAO.BIST");
  await test("XTthyao");
  await test("THYAO:BIST");
}

run();
