/**
 * seans.json içindeki formasyon adlarını Turkish Bulls detay sayfasından yeniden okur.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { extractDetailLevels, isJunkFormationCandidate } = require("./formationExtract");

const DETAIL_URL = "https://www.turkishbulls.com/SignalPage.aspx?lang=tr&Ticker=";
const DETAIL_DELAY_MS = 700;
const TARGET_FILES = ["seans.json", "onay.json"];

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

    try {
      const detail = await extractDetailLevels(detailPage, DETAIL_URL, ticker, safeGoto);
      const next = detail.formasyon;
      const prev = signal.formation || "-";

      if (!next || isJunkFormationCandidate(next)) {
        console.log(`${ticker}: gecersiz/bos cikti, korunuyor "${prev}"`);
        continue;
      }

      if (next !== signal.formation) {
        console.log(`${ticker}: "${prev}" -> "${next}"`);
        signal.formation = next;
        changed += 1;
      } else {
        console.log(`${ticker}: "${prev}" (degismedi)`);
      }
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
