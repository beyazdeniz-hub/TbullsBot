# Firebase senkron (NeuroTrade uygulaması)

Uygulama sinyalleri **Firebase Storage CDN**'den okur — GitHub'daki JSON'lar otomatik düşmez.

## Bir kez kurulum

1. [Firebase Console](https://console.firebase.google.com/project/neurotrade-admin/settings/serviceaccounts/adminsdk) → Service accounts → **Generate new private key**
2. GitHub → bu repo → **Settings** → **Secrets and variables** → **Actions**
3. Secret ekle: `FIREBASE_SERVICE_ACCOUNT_JSON` = indirilen JSON'un **tam metni**

## Her tarama sonrası

`bot.yml` çalışınca `syncSignalsToFirebase()` tüm dosyaları yükler.

Telegram özetinde:
- `Firebase: guncellendi` → OK
- `Firebase: atlandi (secret yok)` → secret eksik veya `bot.yml` env yanlış

## Manuel senkron (hemen)

GitHub → **Actions** → **Firebase Sync** → **Run workflow**

Veya NeuroTrade repo'dan: `npm run signals:sync`

## Doğrulama

NeuroTrade klasöründe:

```powershell
npm run signals:compare
```

GitHub ve Firebase `updatedAt` değerleri eşleşmeli.
