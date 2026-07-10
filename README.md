# FinTrack 💰

Personal finance tracker PWA — expense harian, budget bulanan, assets & net worth.
Vanilla JS, zero build, Firebase Firestore (offline-first), hosted di GitHub Pages.

**Live:** https://xiesandi.cyou/fintrack

## Fitur

- 📒 Catat expense/income/transfer per akun (bank, e-wallet, cash, RDN, broker)
- 📊 Budget bulanan per kategori + progress bar + salin dari bulan lalu
- 💰 Assets (saham IDX per lot, US fractional shares, deposito, dll) dengan harga manual + P&L
- 📈 Net worth otomatis (cash + assets − debt), snapshot bulanan, grafik tren ke target
- 💳 Debt tracker (outstanding, cicilan, jatuh tempo)
- 💵 Kurs USD/IDR auto (frankfurter.app) dengan override manual
- ⚡ Auto price asset: saham IDX (iTick), saham/ETF US (Finnhub), crypto (CoinGecko, tanpa key) — tombol 🔄 di tab Assets + auto-refresh 1x/hari saat app dibuka; per-asset bisa dikunci manual
- ⚡ Offline-first: catat transaksi tanpa internet, auto-sync saat online (Firestore persistence)
- 💾 Backup/restore JSON (Replace All / Merge)
- 📱 PWA installable

## Struktur

```
index.html          app shell
manifest.json       PWA manifest
sw.js               service worker (offline cache)
css/style.css
js/
├─ app.js           entry: auth, router, global UI
├─ firebase.js      init SDK + offline persistence
├─ store.js         state + Firestore listeners + derived calc
├─ db.js            repository: CRUD, seeding, snapshot, backup
├─ kurs.js          kurs USD/IDR auto
├─ tx-sheet.js      sheet tambah/edit transaksi
├─ utils.js         format, tanggal, toast, sheet
└─ views/           home, transactions, budget, wealth, settings
icons/
```

## Deploy (GitHub Pages)

1. Push semua file ini ke repo. Settings → Pages → Deploy from branch.
2. Semua path relative (`./`) — aman untuk subpath `xiesandi.cyou/fintrack`.

Config Firebase di `js/firebase.js` memang public (client-side app).
Keamanan data = Security Rules per-uid + Authorized Domains + API key
HTTP-referrer restriction di Google Cloud Console.

## Setup Firebase (sekali saja)

1. **Authentication → Sign-in method → Google → Enable.**
2. **Authentication → Settings → Authorized domains** → tambahkan `xiesandi.cyou`.
3. **Firestore → Rules** → pasang:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == uid;
    }
  }
}
```

Config Firebase di `js/firebase.js` memang public — data dikunci oleh rules di atas.

## Development lokal

ES modules butuh server (bukan `file://`):

```bash
npx serve
# atau
python3 -m http.server 8080
```

Buka `http://localhost:8080`. Domain `localhost` sudah authorized by default di Firebase.

## Update / deploy versi baru

Setiap ada perubahan file, naikkan `CACHE_VERSION` di `sw.js` (misal `fintrack-v2`) supaya service worker user ter-refresh.
