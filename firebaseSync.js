/**
 * Sinyal JSON'larını Firebase Storage'a yükler.
 * snapshots: { "seans.json": object, ... } — bot taramasından gelen güncel veri (tercih edilen)
 */
const axios = require("axios");
const { Storage } = require("@google-cloud/storage");

const FILES = ["seans.json", "onay.json", "history.json", "signals.json"];
const BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET || "neurotrade-admin.firebasestorage.app";
const PREFIX = process.env.FIREBASE_SIGNALS_PREFIX || "signals";
const BRANCH = process.env.GITHUB_BRANCH || "main";

async function fetchGitHubFile(remotePath, attempt = 1) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    throw new Error("GITHUB_TOKEN veya GITHUB_REPOSITORY eksik");
  }

  const url = `https://api.github.com/repos/${repo}/contents/${remotePath}?ref=${encodeURIComponent(BRANCH)}`;
  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      timeout: 30000,
    });

    const base64 = String(res.data?.content || "").replace(/\n/g, "");
    return Buffer.from(base64, "base64");
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      return fetchGitHubFile(remotePath, attempt + 1);
    }
    throw err;
  }
}

function bodyForFile(file, snapshots) {
  const snap = snapshots?.[file];
  if (snap != null) {
    return Buffer.from(JSON.stringify(snap, null, 2), "utf8");
  }
  return null;
}

async function syncSignalsToFirebase(snapshots) {
  const credRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!credRaw?.trim()) {
    console.log("FIREBASE_SERVICE_ACCOUNT_JSON yok — Firebase sync atlandi");
    return { ok: false, skipped: true };
  }

  let credentials;
  try {
    credentials = JSON.parse(credRaw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON gecersiz JSON");
  }

  const storage = new Storage({
    credentials,
    projectId: credentials.project_id,
  });
  const bucket = storage.bucket(BUCKET);

  console.log(`Firebase sync: gs://${BUCKET}/${PREFIX}/`);

  for (const file of FILES) {
    let body = bodyForFile(file, snapshots);
    if (!body) {
      console.log(`${file}: snapshot yok, GitHub'dan okunuyor...`);
      body = await fetchGitHubFile(file);
    }
    await bucket.file(`${PREFIX}/${file}`).save(body, {
      contentType: "application/json",
      metadata: { cacheControl: "public, max-age=60" },
      resumable: false,
    });
    console.log(`✓ ${PREFIX}/${file}`);
  }

  return { ok: true, skipped: false, files: FILES.length };
}

module.exports = { syncSignalsToFirebase };
