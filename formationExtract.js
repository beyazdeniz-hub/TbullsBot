/**
 * TbullsBot / bot.js — Turkish Bulls detay sayfasından formasyon adı.
 * Site metni: "ÇEKİÇ BOĞA formasyonunun teyidi..." (resmi ad burada).
 */

function trLower(text) {
  return String(text || "")
    .toLowerCase()
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

  return false;
}

function normalizeFormation(raw) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || isJunkFormationCandidate(text)) return "Doji";

  const lower = trLower(text);

  // Bileşik isimler — tek kelimelik kısaltmadan önce (Çekiç Boğa ≠ Çekiç)
  if ((lower.includes("cekic") || lower.includes("hammer")) && /\bbo?ga\b/.test(lower)) {
    return "Çekiç Boğa";
  }
  if (lower.includes("yutan") && /\bbo?ga\b/.test(lower)) return "Yutan Boğa";
  if (lower.includes("yutan") && /\bayi\b/.test(lower)) return "Yutan Ayı";
  if (lower.includes("omuz") && lower.includes("bas")) return "Omuz Baş Omuz";
  if (/\bobo\b/.test(lower)) return "OBO";
  if (lower.includes("sabah") && lower.includes("yildiz")) return "Sabah Yıldızı";
  if (lower.includes("aksam") || lower.includes("akşam")) return "Akşam Yıldızı";
  if (lower.includes("ters") && lower.includes("cekic")) return "Ters Çekiç";
  if (lower.includes("delen")) return "Delen Mumlar";
  if (lower.includes("asili") || lower.includes("asılı")) return "Asılı Adam";
  if (lower.includes("kayan") && lower.includes("yildiz")) return "Kayan Yıldız";
  if (lower.includes("mezar")) return "Mezar Taşı";
  if (lower.includes("yusuf")) return "Yusufçuk";
  if (lower.includes("mizrak") || lower.includes("mızrak")) return "Mızrak";
  if (lower.includes("hamile")) return "Hamile";
  if (lower.includes("harami")) return "Harami";
  if (lower.includes("doji")) return "Doji";
  if (lower.includes("cekic") || lower.includes("hammer")) return "Çekiç";

  // Site metnindeki kısa ifadeyi olduğu gibi koru (ör. "Çekiç Boğa")
  if (text.length <= 40 && /^[\p{L}\s\-]+$/u.test(text) && text.split(/\s+/).length <= 5) {
    return titleCaseTr(text);
  }

  return "Doji";
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

    const fullText = clean(document.body.innerText || "");
    const headerText = fullText.split(/Formasyon\s*Tan[ıiİI]m[ıiİI]/i)[0] || fullText;

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
    const teyitMatch = headerText.match(
      /([A-Za-zÇçĞğİıÖöŞşÜü][A-Za-zÇçĞğİıÖöŞşÜü0-9\s\-]{1,38})\s+formasyonunun\s+teyidi/i
    );
    if (teyitMatch && teyitMatch[1]) {
      formasyonRaw = clean(teyitMatch[1]);
    }

    if (!formasyonRaw) {
      const statusMatch = headerText.match(
        /([A-Za-zÇçĞğİıÖöŞşÜü][A-Za-zÇçĞğİıÖöŞşÜü0-9\s\-]{1,38})\s+formasyonu(?:nun)?(?:\s|$)/i
      );
      if (statusMatch && statusMatch[1] && !/bu|bir|sistemin|boğa|ayı/i.test(statusMatch[1])) {
        formasyonRaw = clean(statusMatch[1]);
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
          formasyonRaw = candidate;
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
          formasyonRaw = inlineMatch[1];
          break;
        }

        const row = cell.closest("tr") || cell.parentElement;
        if (row) {
          const rowText = clean(row.textContent);
          const rowMatch = rowText.match(
            /Al[ıiİI]?\s*Seviyesi\s*[:\s]*[0-9.,]+\s+(.{2,45})/i
          );
          if (rowMatch) {
            formasyonRaw = rowMatch[1];
            break;
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
            formasyonRaw = siblingText;
            break;
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

    // 4) Tanım paragrafı: "bu formasyona çekiç adı"
    if (!formasyonRaw) {
      const nameMatch = fullText.match(
        /bu formasyona\s+([a-zçğiöşüA-ZÇĞİÖŞÜ\s]+?)\s+ad[ıiİI]/i
      );
      if (nameMatch) formasyonRaw = nameMatch[1];
    }

    // 5) Header — uzun eşleşmeler önce
    if (!formasyonRaw) {
      const known = headerText.match(
        /(Çeki[çcÇC]\s+Bo[ğgĞG]a|Yutan\s+Bo[ğgĞG]a|Yutan\s+Ay[ıiIİ]|Omuz\s+Ba[şsŞS]\s+Omuz|Ters\s+Çeki[çcÇC]|Sabah\s+Y[ıiIİ]ld[ıiIİ]z[ıiIİ]|Ak[şsŞS]am\s+Y[ıiIİ]ld[ıiIİ]z[ıiIİ]|Delen\s+Mum|As[ıiIİ]l[ıiIİ]\s+Adam|Kayan\s+Y[ıiIİ]ld[ıiIİ]z|Mezar\s+Ta[şsŞS][ıiIİ]|Yusuf[çcÇC]uk|Hamile|Harami|OBO|Doji|M[ıiIİ]zra[kğg]|Çeki[çcÇC])/i
      );
      if (known && known[1]) formasyonRaw = known[1];
    }

    return { alSeviyesi, stoploss, formasyonRaw };
  });

  return {
    alSeviyesi: parsed.alSeviyesi,
    stoploss: parsed.stoploss,
    formasyon: normalizeFormation(parsed.formasyonRaw),
  };
}

module.exports = { normalizeFormation, extractDetailLevels, isJunkFormationCandidate };
