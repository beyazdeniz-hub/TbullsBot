const axios = require("axios");

async function test() {
  try {
    const res = await axios.get("https://httpbin.org/get", { timeout: 10000 });
    console.log("Internet erisimi VAR");
  } catch (e) {
    console.log("Internet erisimi YOK:", e.message);
  }

  try {
    const res = await axios.get("https://query1.finance.yahoo.com/v8/finance/chart/THYAO.IS", {
      params: { interval: "1d", range: "3mo" },
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });
    console.log("Yahoo:", JSON.stringify(res.data).substring(0, 300));
  } catch (e) {
    console.log("Yahoo hatasi:", e.response?.status, e.message);
  }
}

test();
