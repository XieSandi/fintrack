# FinTrack 💰

Personal finance tracker PWA — expense harian, budget bulanan, assets & net worth.
Vanilla JS, zero build, Firebase Firestore (offline-first), hosted di GitHub Pages.

**Live:** https://xiesandi.cyou/fintrack

## Fitur

- 📒 Catat expense/income/transfer per akun (bank, e-wallet, cash, RDN, broker, kartu kredit)
- 📊 Budget bulanan per kategori + progress bar + salin dari bulan lalu
- 💰 Assets (saham IDX per lot, US fractional shares, deposito, emas, crypto, CAPEX/barang susut,
  dll) dengan harga manual/auto + P&L, plus Catat Pembelian/Penjualan (weighted avg buy price)
- 🎯 Short Term Goals (bisa banyak, topup/pencairan aktif) — bisa juga di-link ke asset yang
  sudah ada, terpisah dari 🏆 Main Milestone (satu target net worth jangka panjang)
- 📈 Net worth otomatis (cash + assets + goal savings − debt), snapshot bulanan, grafik tren &
  dashboard proyeksi ke target
- 💳 Kartu kredit sebagai akun biasa (utang derived dari saldo negatif) + Debt tracker terpisah
  buat cicilan tetap (outstanding, cicilan, jatuh tempo)
- 🔁 Recurring/rutin bulanan (termasuk DCA beli asset) dengan konfirmasi "Awal Bulan"
- 👁️ Blur mode — mask semua angka finansial jadi asterisk (buat dipakai di tempat umum)
- 💵 Kurs USD/IDR auto (frankfurter.app) dengan override manual
- ⚡ Auto price asset: saham IDX (TradingView, tanpa key), saham/ETF US (Finnhub), crypto (CoinGecko, tanpa key) — tombol 🔄 di tab Assets + auto-refresh 1x/hari saat app dibuka; per-asset bisa dikunci manual
- ⚡ Offline-first: catat transaksi tanpa internet, auto-sync saat online (Firestore persistence)
- 📄 Export laporan .md siap paste ke AI, plus backup/restore JSON (Replace All / Merge)
- 🩺 Cek Integritas Data (scan referensi yatim, read-only) + Reset Data (Zona Bahaya)
- 📱 PWA installable

## Struktur

```
index.html            app shell
manifest.json         PWA manifest
sw.js                 service worker (offline cache)
css/style.css
js/
├─ app.js             entry: auth, router, month picker, SW register
├─ firebase.js        init SDK + offline persistence
├─ store.js           state global + Firestore listeners + wrapper ke calc.js
├─ calc.js            kalkulasi murni (saldo, net worth, dll) — ga import Firebase, ditest
├─ db.js              repository: CRUD, seeding, snapshot, backup, bulk delete
├─ integrity.js       scan referensi yatim (read-only)
├─ kurs.js            kurs USD/IDR auto
├─ prices.js          auto price: TradingView (IDX), Finnhub (US), CoinGecko (crypto)
├─ tx-sheet.js        sheet tambah/edit transaksi (quick-add)
├─ recurring-sheet.js sheet konfirmasi "Awal Bulan" (post recurring)
├─ report-md.js       generate laporan finansial .md
├─ utils.js           format, tanggal, toast, sheet, blur mode, hard refresh
└─ views/             home, transactions, budget, wealth, settings, accounts, categories,
                       goals, recurring, danger
icons/
tests/
└─ calc.test.mjs      smoke test manual buat js/calc.js (`node tests/calc.test.mjs`)
```

Dokumentasi lebih lengkap buat development (aturan wajib, arsitektur detail, data model,
known quirks) ada di `CLAUDE.md`; narasi historis "kenapa" di balik keputusan desain & insiden
ada di `DECISIONS.md`; backlog task ada di `TASKS.md`.

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
