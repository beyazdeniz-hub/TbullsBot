/**
 * TbullsBot / bot.js — Turkish Bulls detay sayfasından formasyon adı.
 * Site metni: "ÇEKİÇ BOĞA formasyonunun teyidi..." (resmi ad burada).
 */

const { extractFormationCandleDates } = require("./formationChartExtract");

function trLower(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

function titleCaseTr(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (!word) return "";
      const first = word.charAt(0).toLocaleUpperCase("tr-TR");
      const rest = word.slice(1).toLocaleLowerCase("tr-TR");
      return first + rest;
    })
    .join(" ");
}

function isJunkFormationCandidate(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text || text.length < 2) return true;

  const lower = trLower(text);
  if (/^(nakitte|al|sat|aciga|tetikte|bekle|acilis|kapanis|onceki|alis|satis)/.test(lower)) {
    return true;
  }
  if (/^(en yuksek|en dusuk|degisim|fark|kazanc|sinyal|durumu|piyasa)/.test(lower)) {
    return true;
  }
  if (/^tanimi$/i.test(trLower(text))) return true;
  if (/^[0-9.,+%\-]+$/.test(text)) return true;
  if (/^(nakitte kal|senette kal|alim|satim|tetikte bekle)/i.test(text)) return true;
  if (/teyit\s*grafi|sinyal\s*tarih|formasyon\s*yok|stoploss\s*:/i.test(text)) return true;
  if (/^yok\s+(satis|alis|sat|al)\b/i.test(lower)) return true;
  if (/^son\s+(bo?ga|ayi|formasyon)\b/i.test(lower)) return true;
  if (/sistemimiz|ve\s+teyit|son\s+6\s+ay/i.test(lower)) return true;
  if (/\d\s+\d\s+\d/.test(text)) return true;
  if (text.split(/\s+/).length > 6) return true;

  return false;
}

function finalizeFormation(raw) {
  const normalized = normalizeFormation(raw);
  if (!normalized || isJunkFormationCandidate(normalized)) return "";
  return normalized;
}

/** Turkish Bulls sayfasında görülen bilinen formasyon ifadeleri (uzun eşleşme önce) */
const KNOWN_FORMATION_PHRASES = [
  ["doji yildiz boga", "Doji Yıldız Boğa"],
  ["doji yildiz ayi", "Doji Yıldız Ayı"],
  ["asagi stoploss", "Aşağı Stoploss"],
  ["yukari stoploss", "Yukarı Stoploss"],
  ["kara bulut ayi", "Kara Bulut Ayı"],
  ["siyah karga ayi", "Siyah Karga Ayı"],
  ["inen sahin ayi", "İnen Şahin Ayı"],
  ["yusufcuk boga", "Yusufçuk Boğa"],
  ["yusufcuk bogasi", "Yusufçuk Boğa"],
  ["mezar tasi boga", "Mezar Taşı Boğa"],
  ["mezar tasi bogasi", "Mezar Taşı Boğa"],
  ["degen mumlar boga", "Değen Mumlar Boğa"],
  ["guvercin yuvasi boga", "Güvercin Yuvası Boğa"],
  ["dusen blok boga", "Düşen Blok Boğa"],
  ["cakisan dip boga", "Çakışan Dip Boğa"],
  ["beyaz asker boga", "Beyaz Asker Boğa"],
  ["kros hamile boga", "Kros Hamile Boğa"],
  ["hamile boga", "Hamile Boğa"],
  ["cekic boga", "Çekiç Boğa"],
  ["yutan boga", "Yutan Boğa"],
  ["yutan ayi", "Yutan Ayı"],
  ["doji boga", "Doji Boğa"],
  ["doji ayi", "Doji Ayı"],
  ["omuz bas omuz", "Omuz Baş Omuz"],
  ["sabah yildizi", "Sabah Yıldızı"],
  ["aksam yildizi", "Akşam Yıldızı"],
  ["yildiz boga", "Yıldız Boğa"],
  ["yildiz ayi", "Yıldız Ayı"],
  ["ters cekic", "Ters Çekiç"],
  ["delen mumlar", "Delen Mumlar"],
  ["asili adam", "Asılı Adam"],
  ["kayan yildiz", "Kayan Yıldız"],
  ["mezar tasi", "Mezar Taşı"],
  ["mizrak", "Mızrak"],
  ["harami", "Harami"],
  ["hamile", "Hamile"],
  ["doji", "Doji"],
  ["cekic", "Çekiç"],
  ["obo", "OBO"],
];

function matchKnownFormationPhrase(text) {
  const lower = trLower(text);
  for (const [needle, canonical] of KNOWN_FORMATION_PHRASES) {
    if (lower.includes(needle)) return canonical;
  }
  return null;
}

function normalizeFormation(raw) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || isJunkFormationCandidate(text)) {
    const fromPhrase = matchKnownFormationPhrase(text);
    if (fromPhrase) return fromPhrase;
    return "";
  }

  const phraseHit = matchKnownFormationPhrase(text);
  if (phraseHit) return phraseHit;

  const lower = trLower(text);

  // Bileşik isimler — tek kelimelik kısaltmadan önce
  if (lower.includes("doji") && lower.includes("yildiz") && /\bbo?ga\b/.test(lower)) {
    return "Doji Yıldız Boğa";
  }
  if (lower.includes("doji") && lower.includes("yildiz") && /\bayi\b/.test(lower)) {
    return "Doji Yıldız Ayı";
  }
  if (lower.includes("yusufcuk") && /\bbo?ga\b/.test(lower)) return "Yusufçuk Boğa";
  if (lower.includes("mezar") && /\bbo?ga\b/.test(lower)) return "Mezar Taşı Boğa";
  if (lower.includes("doji") && /\bbo?ga\b/.test(lower)) return "Doji Boğa";
  if (lower.includes("doji") && /\bayi\b/.test(lower)) return "Doji Ayı";
  if (lower.includes("asagi") && lower.includes("stoploss")) return "Aşağı Stoploss";
  if (lower.includes("yukari") && lower.includes("stoploss")) return "Yukarı Stoploss";
  if (lower.includes("kara") && lower.includes("bulut")) return "Kara Bulut Ayı";
  if (lower.includes("siyah") && lower.includes("karga")) return "Siyah Karga Ayı";
  if (lower.includes("inen") && lower.includes("sahin")) return "İnen Şahin Ayı";
  if ((lower.includes("cekic") || lower.includes("hammer")) && /\bbo?ga\b/.test(lower)) {
    return "Çekiç Boğa";
  }
  if (lower.includes("yutan") && /\bbo?ga\b/.test(lower)) return "Yutan Boğa";
  if (lower.includes("yutan") && /\bayi\b/.test(lower)) return "Yutan Ayı";
  if (lower.includes("omuz") && lower.includes("bas")) return "Omuz Baş Omuz";
  if (/\bobo\b/.test(lower)) return "OBO";
  if (lower.includes("sabah") && lower.includes("yildiz")) return "Sabah Yıldızı";
  if (lower.includes("aksam") || lower.includes("akşam")) return "Akşam Yıldızı";
  if (lower.includes("yildiz") && /\bbo?ga\b/.test(lower)) return "Yıldız Boğa";
  if (lower.includes("yildiz") && /\bayi\b/.test(lower)) return "Yıldız Ayı";
  if (lower.includes("ters") && lower.includes("cekic")) return "Ters Çekiç";
  if (lower.includes("delen")) return "Delen Mumlar";
  if (lower.includes("degen")) return "Değen Mumlar Boğa";
  if (lower.includes("asili") || lower.includes("asılı")) return "Asılı Adam";
  if (lower.includes("kayan") && lower.includes("yildiz")) return "Kayan Yıldız";
  if (lower.includes("mezar")) return "Mezar Taşı";
  if (lower.includes("yusuf")) return "Yusufçuk";
  if (lower.includes("mizrak") || lower.includes("mızrak")) return "Mızrak";
  if (lower.includes("hamile")) return "Hamile";
  if (lower.includes("harami")) return "Harami";
  if (/^doji$/i.test(text.trim()) || lower === "doji") return "Doji";
  if (lower.includes("cekic") || lower.includes("hammer")) return "Çekiç";

  // Site metnindeki kısa ifadeyi olduğu gibi koru (ör. "Çekiç Boğa")
  if (text.length <= 40 && /^[\p{L}\s\-]+$/u.test(text) && text.split(/\s+/).length <= 5) {
    const titled = titleCaseTr(text);
    if (!isJunkFormationCandidate(titled)) return titled;
  }

  const titled = titleCaseTr(text);
  if (!isJunkFormationCandidate(titled)) return titled;
  return "";
}

async function extractDetailLevels(detailPage, detailUrl, ticker, safeGoto) {
  await safeGoto(detailPage, `${detailUrl}${ticker}`);

  const parsed = await detailPage.evaluate(() => {
    function clean(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function pick(regexList, haystack) {
      for (const regex of regexList) {
        const m = haystack.match(regex);
        if (m && m[1]) return clean(m[1]);
      }
      return "";
    }

    function isJunkCandidate(raw) {
      const text = clean(raw);
      if (!text || text.length < 2) return true;
      if (/teyit\s*grafi|sinyal\s*tarih|formasyon\s*yok|stoploss\s*:/i.test(text)) return true;
      if (/^yok\s+(sat|al|satis|alis)\b/i.test(text)) return true;
      if (/sistemimiz|ve\s+teyit|son\s+6\s+ay/i.test(text)) return true;
      if (/\d\s+\d\s+\d/.test(text)) return true;
      if (text.split(/\s+/).length > 6) return true;
      return false;
    }

    function acceptFormation(raw) {
      const candidate = clean(raw);
      if (!candidate || isJunkCandidate(candidate)) return false;
      formasyonRaw = candidate;
      return true;
    }

    const fullText = clean(document.body.innerText || "");
    const headerText = fullText.split(/Formasyon\s*Tan[ıiİI]m[ıiİI]/i)[0] || fullText;
    const signalSectionMatch = headerText.match(
      /Sinyal\s*Durumu\s*([\s\S]*?)(?:Piyasa\s*G[öoÖO]r[üuÜU]n[üuÜU]m[üuÜU]|Formasyon\s*Tan)/i
    );
    const signalText = signalSectionMatch
      ? clean(signalSectionMatch[1])
      : headerText.split(/Piyasa/i)[0] || headerText;

    const alSeviyesi =
      pick(
        [
          /Al[ıiİI]?\s*Seviyesi[:\s]*([0-9.,]+)/i,
          /Alış\s*Seviyesi[:\s]*([0-9.,]+)/i,
          /Teyit\s*[Ss]eviyesi[:\s]*([0-9.,]+)/i,
        ],
        headerText
      ) || "-";

    const stoploss =
      pick(
        [
          /Stoploss[:\s]*([0-9.,]+)/i,
          /Stop\s*Loss[:\s]*([0-9.,]+)/i,
          /Stop\s*Seviyesi[:\s]*([0-9.,]+)/i,
          /Stop[:\s]*([0-9.,]+)/i,
        ],
        headerText
      ) || "-";

    let formasyonRaw = "";

    // 0) Sinyal Durumu — sitedeki resmi ad: "ÇEKİÇ BOĞA formasyonunun teyidi"
    const teyitMatch = signalText.match(
      /([A-Za-zÇçĞğİıÖöŞşÜü][A-Za-zÇçĞğİıÖöŞşÜü0-9\s\-]{1,38})\s+formasyonunun\s+teyidi/i
    );
    if (teyitMatch && teyitMatch[1]) {
      acceptFormation(teyitMatch[1]);
    }

    if (!formasyonRaw) {
      const statusMatch = signalText.match(
        /([A-Za-zÇçĞğİıÖöŞşÜü][A-Za-zÇçĞğİıÖöŞşÜü0-9\s\-]{1,38})\s+formasyonu(?:nun)?(?:\s|$)/i
      );
      if (statusMatch && statusMatch[1] && !/bu|bir|sistemin/i.test(statusMatch[1])) {
        acceptFormation(statusMatch[1]);
      }
    }

    // 1) Al Seviyesi satırı yanı — junk filtreli
    if (!formasyonRaw) {
      const alisLine = headerText.match(
        /Al[ıiİI]?\s*Seviyesi\s*[:\s]*([0-9.,]+)\s*([^\n\r|]{1,45})/i
      );
      if (alisLine && alisLine[2]) {
        const candidate = clean(alisLine[2])
          .replace(/^[\(\[\-\|:]+/, "")
          .replace(/[\)\]\-\|:]+$/, "");
        if (candidate && !/^(a[cç]ili[sş]|kapan|önceki|en\s)/i.test(candidate)) {
          acceptFormation(candidate);
        }
      }
    }

    // 2) DOM — Al Seviyesi hücresi
    if (!formasyonRaw) {
      const cells = Array.from(
        document.querySelectorAll("td, th, div, span, font, b, strong, label")
      );

      for (const cell of cells) {
        const text = clean(cell.textContent);
        if (!/Al[ıiİI]?\s*Seviyesi/i.test(text)) continue;

        const inline = text.replace(/.*Al[ıiİI]?\s*Seviyesi\s*[:\s]*/i, "").trim();
        const inlineMatch = inline.match(/^[0-9.,]+\s+(.{2,45})$/);
        if (inlineMatch) {
          acceptFormation(inlineMatch[1]);
          if (formasyonRaw) break;
        }

        const row = cell.closest("tr") || cell.parentElement;
        if (row) {
          const rowText = clean(row.textContent);
          const rowMatch = rowText.match(
            /Al[ıiİI]?\s*Seviyesi\s*[:\s]*[0-9.,]+\s+(.{2,45})/i
          );
          if (rowMatch) {
            acceptFormation(rowMatch[1]);
            if (formasyonRaw) break;
          }
        }

        const sibling = cell.nextElementSibling;
        if (sibling) {
          const siblingText = clean(sibling.textContent);
          if (
            siblingText &&
            !/^[0-9.,]+$/.test(siblingText) &&
            siblingText.length <= 45 &&
            !/Kapan|Önceki|Sat|Açılış/i.test(siblingText)
          ) {
            acceptFormation(siblingText);
            if (formasyonRaw) break;
          }
        }
      }
    }

    // 3) Formasyon etiketi (Tanımı hariç)
    if (!formasyonRaw) {
      formasyonRaw = pick(
        [
          /Formasyon\s*(?!Tanımı)[:\s-]+([A-Za-zÇçĞğİıÖöŞşÜü0-9\s\-]{2,45})/i,
          /Son\s*Formasyon\s*[:\s-]+([A-Za-zÇçĞğİıÖöŞşÜü0-9\s\-]{2,45})/i,
        ],
        headerText
      );
    }

    // 4) Tanım paragrafı — resmi tırnaklı ad veya "bu formasyona X adı"
    if (!formasyonRaw) {
      const defSection = fullText.split(/Formasyon\s*Tan[ıiİI]m[ıiİI]/i)[1] || "";
      const quotedMatch = defSection.match(
        /[“"]([A-Za-zÇçĞğİıÖöŞşÜü][^"”]{2,38})[”"]/
      );
      if (quotedMatch && quotedMatch[1]) {
        acceptFormation(quotedMatch[1]);
      }
    }

    if (!formasyonRaw) {
      const nameMatch = fullText.match(
        /bu formasyona\s+([a-zçğiöşüA-ZÇĞİÖŞÜ\s]+?)\s+ad[ıiİI]/i
      );
      if (nameMatch) acceptFormation(nameMatch[1]);
    }

    // 5) Header / grafik etiketi — bilinen çok kelimeli formasyonlar (NAKİTTE KAL olsa bile)
    if (!formasyonRaw) {
      const phrasePatterns = [
        /Doji\s+Y[ıiIİİ]ld[ıiIİ]z\s+Bo[ğgGĞ]a/i,
        /Doji\s+Y[ıiIİİ]ld[ıiIİ]z\s+Ay[ıiIİ]/i,
        /Doji\s+Bo[ğgGĞ]a/i,
        /Doji\s+Ay[ıiIİ]/i,
        /Yusuf[çcÇC]uk\s+Bo[ğgGĞ]a/i,
        /Mezar\s+Ta[şsŞS][ıiIİ]\s+Bo[ğgGĞ]a/i,
        /De[ğgGĞ]en\s+Mumlar?\s+Bo[ğgGĞ]a/i,
        /G[üuÜU]vercin\s+Yuvas[ıiİI]\s+Bo[ğgGĞ]a/i,
        /D[üuÜU]şen\s+Blok\s+Bo[ğgGĞ]a/i,
        /[ÇC]ak[ıiİI][şsŞS]an\s+Dip\s+Bo[ğgGĞ]a/i,
        /Beyaz\s+Asker\s+Bo[ğgGĞ]a/i,
        /Kros\s+Hamile\s+Bo[ğgGĞ]a/i,
        /[ÇC]eki[çcÇC]\s+Bo[ğgGĞ]a/i,
        /Yutan\s+Bo[ğgGĞ]a/i,
        /Yutan\s+Ay[ıiIİ]/i,
        /Omuz\s+Ba[şsŞS]\s+Omuz/i,
        /Sabah\s+Y[ıiIİ]ld[ıiIİ]z[ıiIİ]/i,
        /Ak[şsŞS]am\s+Y[ıiIİ]ld[ıiIİ]z[ıiIİ]/i,
        /Delen\s+Mumlar?/i,
        /Hamile/i,
        /Harami/i,
        /OBO/i,
        /\bDoji\b/i,
      ];
      for (const pattern of phrasePatterns) {
        const m = headerText.match(pattern);
        if (m && m[0]) {
          acceptFormation(m[0]);
          if (formasyonRaw) break;
        }
      }
    }

    // 6) Header — kısa tek kelimelik eşleşmeler
    if (!formasyonRaw) {
      const known = headerText.match(
        /(Doji\s+Y[ıiIİİ]ld[ıiIİ]z\s+Bo[ğgGĞ]a|Doji\s+Y[ıiIİİ]ld[ıiIİ]z\s+Ay[ıiIİ]|Doji\s+Bo[ğgGĞ]a|Doji\s+Ay[ıiIİ]|Yusuf[çcÇC]uk\s+Bo[ğgGĞ]a|Mezar\s+Ta[şsŞS][ıiIİ]\s+Bo[ğgGĞ]a|Çeki[çcÇC]\s+Bo[ğgGĞ]a|Yutan\s+Bo[ğgGĞ]a|Yutan\s+Ay[ıiIİ]|Omuz\s+Ba[şsŞS]\s+Omuz|Ters\s+Çeki[çcÇC]|Sabah\s+Y[ıiIİ]ld[ıiIİ]z[ıiIİ]|Ak[şsŞS]am\s+Y[ıiIİ]ld[ıiIİ]z[ıiIİ]|Delen\s+Mum|De[ğgGĞ]en\s+Mum|As[ıiIİ]l[ıiIİ]\s+Adam|Kayan\s+Y[ıiIİ]ld[ıiIİ]z|Mezar\s+Ta[şsŞS][ıiIİ]|Yusuf[çcÇC]uk|Hamile|Harami|OBO|\bDoji\b|M[ıiIİ]zra[kğg]|Çeki[çcÇC])/i
      );
      if (known && known[1]) acceptFormation(known[1]);
    }

    function pickDate(regexList, haystack) {
      for (const regex of regexList) {
        const m = haystack.match(regex);
        if (m && m[1]) return clean(m[1]);
      }
      return "";
    }

    const formationDate = pickDate(
      [
        /Formasyon\s*Tarihi\s*[:\s]*(\d{2}[./]\d{2}[./]\d{4})/i,
        /Formasyon\s*Olu[sş]um\s*[:\s]*(\d{2}[./]\d{2}[./]\d{4})/i,
        /Formasyon\s*Biti[sş]\s*[:\s]*(\d{2}[./]\d{2}[./]\d{4})/i,
        /Son\s*Formasyon[\s\S]{0,100}?(\d{2}[./]\d{2}[./]\d{4})/i,
      ],
      headerText
    );

    const signalDate = pickDate(
      [/Sinyal\s*Tarihi\s*[:\s]*(\d{2}[./]\d{2}[./]\d{4})/i],
      headerText
    );

    let formasyonTarihi = formationDate;
    if (!formasyonTarihi && signalDate) {
      formasyonTarihi = signalDate;
    }

    // Grafik alt etiketi / teyit bölgesindeki tarih (TB DD/MM/YYYY)
    if (!formasyonTarihi) {
      const chartDates = [];
      const dateRe = /\b(\d{2})[./](\d{2})[./](\d{4})\b/g;
      let dm;
      const teyitBlock = fullText.split(/Teyit\s*Grafi/i)[1]?.slice(0, 2500) || "";
      const scanBlock = teyitBlock || headerText.slice(0, 4000);
      while ((dm = dateRe.exec(scanBlock)) !== null) {
        chartDates.push(`${dm[1]}.${dm[2]}.${dm[3]}`);
      }
      if (chartDates.length >= 2) {
        formasyonTarihi = chartDates[chartDates.length - 2];
      } else if (chartDates.length === 1) {
        formasyonTarihi = chartDates[0];
      }
    }

    if (formasyonTarihi) {
      formasyonTarihi = formasyonTarihi.replace(/\//g, ".");
    }

    return { alSeviyesi, stoploss, formasyonRaw, formasyonTarihi: formasyonTarihi || "" };
  });

  const chartDates = await extractFormationCandleDates(detailPage);
  const fromChart = chartDates.formationDates || [];
  const textDate = parsed.formasyonTarihi || "";

  let formationDates = fromChart.length ? fromChart : textDate ? [textDate] : [];
  let formationDate = formationDates.length
    ? formationDates[formationDates.length - 1]
    : textDate;

  if (fromChart.length) {
    formationDate = fromChart[fromChart.length - 1];
  }

  return {
    alSeviyesi: parsed.alSeviyesi,
    stoploss: parsed.stoploss,
    formasyon: finalizeFormation(parsed.formasyonRaw),
    formationDate: formationDate || "",
    formationDates,
    chartMeta: chartDates.chartMeta,
  };
}

module.exports = {
  normalizeFormation,
  finalizeFormation,
  extractDetailLevels,
  isJunkFormationCandidate,
  matchKnownFormationPhrase,
  KNOWN_FORMATION_PHRASES,
};
