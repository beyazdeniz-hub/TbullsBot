/**
 * seans.json / onay.json içindeki formasyon adlarını Turkish Bulls detay sayfasından yeniden okur.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { extractDetailLevels, isJunkFormationCandidate } = require("./formationExtract");

const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";
const DETAIL_DELAY_MS = 700;
const TARGET_FILES = ["seans.json", "onay.json"];

const FUND_SUFFIXES = ["ZF", "DF", "OTF", "PKF", "PPF", "YSF"];
const FUND_BLOCKLIST = new Set(["QTEMZF", "APGLDF", "USDTRF", "TEMZF", "ZELOTF"]);

function isTradeableEquity(ticker) {
  const t = String(ticker || "").trim().toUpperCase();
  if (!t || t.length < 2) return false;
  if (FUND_BLOCKLIST.has(t)) return false;
  for (const suffix of FUND_SUFFIXES) {
    if (t.length >= 5 && t.endsWith(suffix)) return false;
  }
  if (t.length >= 6 && t.endsWith("TRF")) return false;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTurkeyDateTime() {
  return new Date().toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function safeGoto(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3500);
}

async function refreshFile(detailPage, filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.log(`Atlandi (yok): ${filePath}`);
    return 0;
  }

  const data = JSON.parse(fs.readFileSync(abs, "utf8"));
  const signals = Array.isArray(data.signals) ? data.signals : [];
  let changed = 0;

  console.log(`\n=== ${filePath} (${signals.length} sinyal) ===`);

  for (const signal of signals) {
    const ticker = String(signal.ticker || "").trim().toUpperCase();
    if (!ticker) continue;
    if (!isTradeableEquity(ticker)) {
      console.log(`${ticker}: fon/portfoy — atlandi`);
      continue;
    }

    try {
      const detail = await extractDetailLevels(detailPage, DETAIL_URL, ticker, safeGoto);
      const next = detail.formasyon;
      const prev = signal.formation || "-";
      let rowChanged = false;

      if (!next || isJunkFormationCandidate(next)) {
        console.log(`${ticker}: gecersiz/bos cikti, korunuyor "${prev}"`);
      } else if (next !== signal.formation) {
        console.log(`${ticker}: formasyon "${prev}" -> "${next}"`);
        signal.formation = next;
        rowChanged = true;
      } else {
        console.log(`${ticker}: formasyon "${prev}" (degismedi)`);
      }

      const nextDates = Array.isArray(detail.formationDates)
        ? detail.formationDates.filter(Boolean)
        : [];
      const prevDates = Array.isArray(signal.formationDates) ? signal.formationDates : [];
      if (
        nextDates.length &&
        JSON.stringify(nextDates) !== JSON.stringify(prevDates)
      ) {
        console.log(
          `${ticker}: formationDates ${prevDates.join(",") || "-"} -> ${nextDates.join(",")}`
        );
        signal.formationDates = nextDates;
        rowChanged = true;
      }

      const nextDate = detail.formationDate || (nextDates.length ? nextDates[nextDates.length - 1] : "");
      if (nextDate && nextDate !== (signal.formationDate || "")) {
        console.log(`${ticker}: formationDate ${signal.formationDate || "-"} -> ${nextDate}`);
        signal.formationDate = nextDate;
        rowChanged = true;
      }

      if (rowChanged) changed += 1;
    } catch (err) {
      console.log(`${ticker}: HATA — ${err.message}`);
    }

    await sleep(DETAIL_DELAY_MS);
  }

  if (changed > 0) {
    data.updatedAt = formatTurkeyDateTime();
    fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`${filePath}: ${changed} formasyon guncellendi.`);
  } else {
    console.log(`${filePath}: degisiklik yok.`);
  }

  return changed;
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const detailPage = await browser.newPage();
    await detailPage.setViewport({ width: 1400, height: 2200 });
    let total = 0;
    for (const file of TARGET_FILES) {
      total += await refreshFile(detailPage, file);
    }
    console.log(`\nToplam guncellenen: ${total}`);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("refreshFormations HATA:", err.message);
  process.exit(1);
});
