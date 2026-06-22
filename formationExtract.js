/**
 * TbullsBot / bot.js içinde kullanılacak formasyon okuma mantığı.
 * Sorun: Eski kod tüm sayfa metninde "hamile" vb. arıyordu → çoğu hisse yanlışlıkla "Harami".
 * Çözüm: Önce Alış Seviyesi satırı / DOM, sonra header, en son tanım metni.
 */

function normalizeFormation(raw) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "Doji";

  const lower = text
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");

  if (/^(nakitte|al|sat|aciga|tetikte|bekle)/.test(lower)) return "";
  if (/^[0-9.,]+$/.test(lower)) return "";

  if (lower.includes("yutan") && lower.includes("bo")) return "Yutan Boğa";
  if (lower.includes("yutan") && lower.includes("ay")) return "Yutan Ayı";
  if (lower.includes("omuz") && lower.includes("bas")) return "Omuz Baş Omuz";
  if (lower.includes("obo")) return "OBO";
  if (lower.includes("sabah") && lower.includes("yildiz")) return "Sabah Yıldızı";
  if (lower.includes("aksam") || lower.includes("akşam")) return "Akşam Yıldızı";
  if (lower.includes("ters") && lower.includes("cekic")) return "Ters Çekiç";
  if (lower.includes("cekic") || lower.includes("hammer")) return "Çekiç";
  if (lower.includes("delen")) return "Delen Mumlar";
  if (lower.includes("asili") || lower.includes("asılı")) return "Asılı Adam";
  if (lower.includes("kayan") && lower.includes("yildiz")) return "Kayan Yıldız";
  if (lower.includes("mezar")) return "Mezar Taşı";
  if (lower.includes("yusuf")) return "Yusufçuk";
  if (lower.includes("harami")) return "Harami";
  if (lower.includes("mizrak") || lower.includes("mızrak")) return "Mızrak";
  if (lower.includes("doji")) return "Doji";

  if (text.length <= 36 && /[A-Za-zÇçĞğİıÖöŞşÜü]/.test(text)) {
    return text;
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
          /Al[:\s]*([0-9.,]+)/i,
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

    // 1) Fiyat alanının hemen yanındaki metin: "Al Seviyesi 12,34 Çekiç"
    const alisLine = headerText.match(
      /Al[ıiİI]?\s*Seviyesi\s*[:\s]*([0-9.,]+)\s*([^\n\r|]{1,45})/i
    );
    if (alisLine && alisLine[2]) {
      formasyonRaw = clean(alisLine[2])
        .replace(/^[\(\[\-\|:]+/, "")
        .replace(/[\)\]\-\|:]+$/, "");
    }

    // 2) DOM — Al Seviyesi etiketli satır / komşu hücre
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
            !/Kapan|Önceki|Sat/i.test(siblingText)
          ) {
            formasyonRaw = siblingText;
            break;
          }
        }
      }
    }

    // 3) Açık Formasyon etiketi (üst bölüm)
    if (!formasyonRaw) {
      formasyonRaw = pick(
        [
          /Formasyon\s*[:\s-]*([A-Za-zÇçĞğİıÖöŞşÜü0-9\s\-]{2,45})/i,
          /Son\s*Formasyon\s*[:\s-]*([A-Za-zÇçĞğİıÖöŞşÜü0-9\s\-]{2,45})/i,
        ],
        headerText
      );
    }

    // 4) Tanım: "bu formasyona çekiç adı..."
    if (!formasyonRaw) {
      const nameMatch = fullText.match(
        /bu formasyona\s+([a-zçğiöşüA-ZÇĞİÖŞÜ\s]+?)\s+ad[ıiİI]/i
      );
      if (nameMatch) formasyonRaw = nameMatch[1];
    }

    // 5) Header'da bilinen formasyon adı (tanım paragrafı hariç)
    if (!formasyonRaw) {
      const known = headerText.match(
        /(Yutan\s+Bo[ğgĞG]a|Yutan\s+Ay[ıiIİ]|Omuz\s+Ba[şsŞS]\s+Omuz|OBO|Çeki[çcÇC]|Ters\s+Çeki[çcÇC]|Sabah\s+Y[ıiIİ]ld[ıiIİ]z[ıiIİ]|Ak[şsŞS]am\s+Y[ıiIİ]ld[ıiIİ]z[ıiIİ]|Delen\s+Mum|As[ıiIİ]l[ıiIİ]\s+Adam|Kayan\s+Y[ıiIİ]ld[ıiIİ]z|Mezar\s+Ta[şsŞS][ıiIİ]|Yusuf[çcÇC]uk|Harami|Hamile|Doji|M[ıiIİ]zra[kğg])/i
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

module.exports = { normalizeFormation, extractDetailLevels };
