# FinTrack — Project Context

Personal finance tracker PWA milik satu user (owner repo). Live di https://xiesandi.cyou/fintrack
(GitHub Pages, custom domain, subpath). Track expense harian, budget bulanan, assets, debt,
net worth menuju target Rp 100 juta akhir 2028.

## Stack & Prinsip (JANGAN diubah tanpa diskusi)

- **Vanilla JS (ES modules) + plain CSS. ZERO build step.** No framework, no bundler, no npm.
  Push ke `main` = deploy. Jangan introduce React/Vite/Tailwind/tooling apapun.
- **Firebase**: Auth (Google Sign-In) + **Firestore** dengan `persistentLocalCache` = offline-first.
  Data path: `users/{uid}/...`, dikunci Security Rules per-uid. Config di `js/firebase.js`
  sengaja hardcoded (client-side, bukan secret; proteksi = rules + authorized domains + API key
  HTTP-referrer restriction).
- **Semua path relative (`./`)** karena hosting di subpath `/fintrack/`. Jangan pakai absolute path.
- Bahasa UI: Indonesia santai (lo/gue). Format uang: `Intl id-ID` → "Rp 1.500.000".

## Arsitektur

```
index.html            shell: header, #view, FAB, bottom nav, sheet, toast
css/style.css         dark theme, mobile-first, CSS vars di :root
js/app.js             entry: auth flow, hash router (ROUTES), month picker, SW register + auto-update
js/firebase.js        init SDK via CDN gstatic + offline persistence
js/store.js           state global + onSnapshot listeners + SEMUA derived calc (saldo, net worth, dll)
js/db.js              repository: CRUD generik, seeding kategori, snapshot bulanan, export/import backup
js/prices.js          auto price: iTick (IDX), Finnhub (US), CoinGecko (crypto, tanpa key)
js/kurs.js            kurs USD/IDR auto via frankfurter.app, cache localStorage
js/tx-sheet.js        bottom sheet tambah/edit transaksi (quick-add)
js/utils.js           format, tanggal, toast, openSheet/closeSheet, escapeHtml
js/views/             home, transactions, budget, wealth, settings, accounts, categories
sw.js                 service worker: precache shell, runtime cache gstatic+jsdelivr
```

Routing: hash (`#/home`). Nav: Home · History (transactions) · Assets (wealth) · Setting.
Budget/Akun/Kategori = subpage di dalam Setting (punya `back` di ROUTES).

## Data Model (Firestore `users/{uid}/`)

- `accounts` — kantong uang (bank/ewallet/cash/rdn/broker), currency IDR/USD, initialBalance.
  **Saldo TIDAK disimpan** — dihitung dari jurnal: initialBalance ± transaksi (lihat `accountBalances()`).
- `transactions` — {date, month:"YYYY-MM", amount, type: expense|income|transfer, accountId,
  toAccountId?, categoryId, note}. Transfer = 1 record, BUKAN expense.
- `budgets` — id deterministik `{month}_{categoryId}`.
- `assets` — saham IDX (quantity dalam **LOT**, ×100 lembar saat hitung nilai), US fractional shares,
  dll. `manualPrice` + `manualPriceUpdatedAt` + `priceSource`. `manualOnly:true` = skip auto-refresh.
- `debts` — outstanding, monthlyInstalment, dueDay, remainingMonths. Mengurangi net worth.
- `snapshots/{YYYY-MM}` — net worth bulanan, di-upsert otomatis saat app dibuka (`upsertSnapshot`).
- `settings/main` — targetNetWorth, usdIdrManual, apiKeys:{itick, finnhub}, lastBackupAt.

Net worth = totalCashIDR + totalAssetsIDR − totalDebtIDR (USD dikonversi `effectiveRate()`).

## ATURAN WAJIB saat mengubah kode

1. **Setiap deploy perubahan file apapun: naikin `CACHE_VERSION` di `sw.js`** (v4 → v5 dst).
   Kalau lupa, user PWA ga dapet update. File baru juga wajib ditambah ke array `PRECACHE`.
2. Semua akses Firestore lewat `js/db.js` (add/put/patch/remove) — jangan tulis setDoc langsung di view.
3. View re-render otomatis via `store.on()` setelah data berubah — jangan manual manipulasi DOM
   setelah save; cukup tutup sheet + toast.
4. User input selalu lewat `escapeHtml()` sebelum masuk innerHTML (XSS).
5. Semua fitur inti harus tetap jalan **offline** (Firestore persistence yang handle sync).
6. Jangan tambah dependency eksternal kecuali via CDN dan di-cache di sw.js runtime cache.
7. Angka harga asset selalu tampil dengan timestamp "per {tanggal}" — jangan pernah tampilkan
   harga tanpa keterangan kapan.

## Known Quirks

- iTick (`js/prices.js`, `fetchIDX`) — terverifikasi live: `GET /stock/quotes?region=ID&codes=...`,
  header `token`, response `{code, msg, data:{SYMBOL:{ld, ...}}}`, harga di field `ld`.
  **Free/personal tier maks 3 simbol per call** (lebih dari itu → `{code:1, msg:"your request
  is too much"}` walau HTTP 200) — kode udah nge-chunk per 3 (`ITICK_CHUNK`), jangan dihapus
  kalau nambahin logic baru di sini.
- Chart.js dari jsdelivr CDN; kalau belum ke-cache dan offline, chart area menampilkan pesan fallback.
- iOS Safari bisa evict storage PWA — data master di cloud, jadi worst case re-sync saat login.
- `attachThousands()` memformat input ribuan live; parse balik pakai `parseAmount()`.
- GitHub Pages (Fastly, di belakang custom domain xiesandi.cyou) nge-serve `sw.js` dengan
  `Cache-Control: max-age=14400` (4 jam), ga bisa dioverride header-nya. Update SW jadi bisa
  ke-detect telat. Register pakai `{ updateViaCache: "none" }` biar `reg.update()` minimal
  ga kena HTTP cache browser sendiri.
  **JANGAN** pasang query string cache-buster (`?v=${Date.now()}`) di URL registrasi SW dan
  **JANGAN** panggil `self.skipWaiting()` otomatis di `install` — kombinasi itu + `clients.claim()`
  + auto-`location.reload()` on `controllerchange` pernah bikin app kejebak infinite-reload-loop
  di HP (pernah kejadian, lihat commit fix-nya). Sekarang SW baru sengaja nunggu pasif
  ("waiting") sampe user trigger sendiri lewat tombol **Hard Refresh** di Setting
  (`hardRefresh()` di `utils.js`: unregister semua SW + `caches.delete()` semua + reload) —
  jangan tambahin balik auto-activate/auto-reload tanpa mikir ulang soal loop risk ini.

## Roadmap (belum dibuat, urutan prioritas)

1. Recurring transactions — template (kost tgl 1, transfer ortu tgl 28) → prompt "catat sekarang?"
2. Blur mode saldo (sembunyikan angka di tempat umum, toggle mata)
3. Copy budget otomatis tiap awal bulan
4. Import CSV mutasi bank; laporan tahunan; enkripsi backup (Web Crypto)
5. Harga emas & NAV reksa dana: BELUM ada API gratis+CORS yang stabil → tetap manual

## Konteks Owner (untuk fitur/copy)

Usia 26, fase asset accumulation. Gaji ~9jt/bln (gajian tgl 28). Akun: BCA (payroll),
bank digital (operational, bunga 6% pa), RDN, Bibit (RDPU), Pluang (US stocks).
Portfolio: BBCA/BBRI/ADRO/WBSA (IDX), VOO/SCHD (US). Debt aktif: Tokopedia CC (tgl 15),
Shopee BNPL (tgl 11, lunas Agt 2026). Target: 100jt aset akhir 2028, debt-free Jan 2027.
