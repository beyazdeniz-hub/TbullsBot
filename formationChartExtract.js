/**
 * Turkish Bulls teyit grafiğinde formasyon mumları parlak, diğerleri soluk.
 * Grafik görselinden sütun bazlı doygunluk ölçerek hangi tarihlerin vurgulu olduğunu çıkarır.
 */

function normalizeTbDate(raw) {
  const m = String(raw || "").trim().match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (!m) return "";
  return `${m[1]}.${m[2]}.${m[3]}`;
}

function parseDateKey(d) {
  const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return 0;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

/**
 * Puppeteer page.evaluate içinde çalışır — canvas ile grafik img analizi.
 */
function extractFormationCandleDatesInBrowser() {
  function clean(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeDate(raw) {
    const m = String(raw || "")
      .trim()
      .match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
    if (!m) return "";
    return `${m[1]}.${m[2]}.${m[3]}`;
  }

  function parseKey(d) {
    const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return 0;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  }

  function collectAxisDates(fullText, maxCount) {
    const re = /\b(\d{2})[./](\d{2})[./](\d{4})\b/g;
    const teyitIdx = fullText.search(/Teyit\s*Grafi/i);
    const block =
      teyitIdx >= 0 ? fullText.slice(teyitIdx, teyitIdx + 3500) : fullText.slice(0, 6000);
    const seen = new Set();
    const list = [];
    let m;
    while ((m = re.exec(block)) !== null) {
      const d = normalizeDate(`${m[1]}.${m[2]}.${m[3]}`);
      if (!d || seen.has(d)) continue;
      seen.add(d);
      list.push(d);
    }
    list.sort((a, b) => parseKey(a) - parseKey(b));
    if (list.length <= maxCount) return list;
    return list.slice(list.length - maxCount);
  }

  function pickChartImage() {
    const imgs = Array.from(document.querySelectorAll("img"));
    let best = null;
    let bestArea = 0;
    for (const img of imgs) {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      const area = w * h;
      if (area < 80000) continue;
      const src = String(img.src || img.getAttribute("src") || "").toLowerCase();
      const bonus =
        /chart|candle|signal|grafik|teyit|mum/.test(src) ||
        /chart|candle|signal|grafik|teyit|mum/.test(String(img.alt || "").toLowerCase())
          ? 1.35
          : 1;
      const score = area * bonus;
      if (score > bestArea) {
        bestArea = score;
        best = img;
      }
    }
    return best;
  }

  const fullText = clean(document.body.innerText || "");
  const chartImg = pickChartImage();
  if (!chartImg) {
    return { formationDates: [], method: "no-chart-img" };
  }

  const canvas = document.createElement("canvas");
  const w = chartImg.naturalWidth || chartImg.width;
  const h = chartImg.naturalHeight || chartImg.height;
  if (!w || !h) return { formationDates: [], method: "zero-size-img" };

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { formationDates: [], method: "no-canvas" };

  try {
    ctx.drawImage(chartImg, 0, 0, w, h);
  } catch {
    return { formationDates: [], method: "draw-failed" };
  }

  const x0 = Math.floor(w * 0.07);
  const x1 = Math.floor(w * 0.96);
  const y0 = Math.floor(h * 0.1);
  const y1 = Math.floor(h * 0.76);
  const plotW = x1 - x0;

  const axisDates = collectAxisDates(fullText, 14);
  const numCols = Math.max(4, Math.min(14, axisDates.length || 10));

  const colScores = [];
  for (let col = 0; col < numCols; col++) {
    const cx0 = x0 + (col * plotW) / numCols;
    const cx1 = x0 + ((col + 1) * plotW) / numCols;
    let vivid = 0;
    let gray = 0;
    let samples = 0;

    for (let x = Math.floor(cx0 + 2); x < Math.floor(cx1 - 2); x += 3) {
      for (let y = y0; y < y1; y += 4) {
        const px = ctx.getImageData(x, y, 1, 1).data;
        const r = px[0];
        const g = px[1];
        const b = px[2];
        const maxc = Math.max(r, g, b);
        const minc = Math.min(r, g, b);
        const sat = maxc - minc;
        const avg = (r + g + b) / 3;
        const isBackground = avg > 210 && sat < 25;
        if (isBackground) continue;
        samples += 1;
        const isFadedGray = sat < 42 && avg > 95 && avg < 195;
        if (isFadedGray) gray += 1;
        else if (sat >= 45 || (g > r + 18 && g > b + 10) || (r > g + 18 && r > b + 10)) {
          vivid += 1;
        }
      }
    }

    const vividRatio = samples > 0 ? vivid / samples : 0;
    const grayRatio = samples > 0 ? gray / samples : 0;
    colScores.push({ col, vividRatio, grayRatio, samples });
  }

  if (!colScores.some((c) => c.samples > 8)) {
    return { formationDates: [], method: "no-samples" };
  }

  const vividValues = colScores.map((c) => c.vividRatio).sort((a, b) => a - b);
  const median = vividValues[Math.floor(vividValues.length / 2)] ?? 0;
  const threshold = Math.max(median * 1.35 + 0.04, 0.12);

  let highlightCols = colScores
    .filter((c) => c.vividRatio >= threshold && c.vividRatio > c.grayRatio * 0.85)
    .map((c) => c.col);

  if (highlightCols.length === 0) {
    highlightCols = colScores
      .slice()
      .sort((a, b) => b.vividRatio - a.vividRatio)
      .slice(0, 2)
      .map((c) => c.col)
      .sort((a, b) => a - b);
  }

  if (highlightCols.length > 4) {
    highlightCols = highlightCols.slice(-3);
  }

  const orderedDates =
    axisDates.length >= numCols
      ? axisDates.slice(axisDates.length - numCols)
      : axisDates;

  const formationDates = [];
  for (const col of highlightCols) {
    if (col >= 0 && col < orderedDates.length) {
      formationDates.push(orderedDates[col]);
    }
  }

  const uniq = [...new Set(formationDates)].sort((a, b) => parseKey(a) - parseKey(b));

  return {
    formationDates: uniq,
    method: uniq.length ? "chart-vivid-cols" : "chart-no-match",
    numCols,
    highlightCols,
    axisDates: orderedDates,
  };
}

async function extractFormationCandleDates(page) {
  try {
    const result = await page.evaluate(extractFormationCandleDatesInBrowser);
    const dates = (result?.formationDates || [])
      .map(normalizeTbDate)
      .filter(Boolean);
    return {
      formationDates: dates,
      formationDate: dates.length ? dates[dates.length - 1] : "",
      chartMeta: {
        method: result?.method || "",
        numCols: result?.numCols,
        highlightCols: result?.highlightCols,
      },
    };
  } catch (err) {
    return {
      formationDates: [],
      formationDate: "",
      chartMeta: { method: "error", error: String(err.message || err) },
    };
  }
}

module.exports = {
  extractFormationCandleDates,
  extractFormationCandleDatesInBrowser,
  normalizeTbDate,
};
