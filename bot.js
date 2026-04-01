async function ekranGoruntusuAl(page, ticker) {
  await page.setViewport({ width: 1400, height: 2200, deviceScaleFactor: 1 });

  await page.goto(`${DETAIL_URL}${ticker}`, {
    waitUntil: "networkidle2",
    timeout: 90000,
  });

  await sleep(5000);

  // Sayfayı biraz aşağı indir ki grafik kesin görünür olsun
  await page.evaluate(() => {
    window.scrollTo(0, 300);
  });

  await sleep(2000);

  // Grafik alanını bul
  const grafikHandle = await page.evaluateHandle(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    for (const img of imgs) {
      const src = (img.getAttribute("src") || "").toLowerCase();
      const w = img.width || 0;
      const h = img.height || 0;

      // Turkishbulls detay sayfasındaki grafik resmi benzeri öğeyi yakala
      if (
        (src.includes("chart") ||
          src.includes("signal") ||
          src.includes("graph") ||
          src.includes("ticker")) &&
        w > 400 &&
        h > 250
      ) {
        return img;
      }
    }

    // Olmazsa büyük görseller içinden seç
    const buyukler = imgs
      .filter(img => (img.width || 0) > 500 && (img.height || 0) > 250)
      .sort((a, b) => (b.width * b.height) - (a.width * a.height));

    return buyukler[0] || null;
  });

  const grafikElement = grafikHandle.asElement();

  if (!grafikElement) {
    const tumSayfa = `tum_sayfa_${ticker}.png`;
    await page.screenshot({ path: tumSayfa, fullPage: true });
    throw new Error(`Grafik elementi bulunamadı. Kontrol için ${tumSayfa} oluşturuldu.`);
  }

  await grafikElement.screenshot({
    path: `grafik_${ticker}.png`,
  });

  return `grafik_${ticker}.png`;
}