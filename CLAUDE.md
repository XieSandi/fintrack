# FinTrack — Project Context

Personal finance tracker PWA milik satu user (owner repo). Live di https://xiesandi.cyou/fintrack
(GitHub Pages, custom domain, subpath). Track expense harian, budget bulanan, assets, debt,
net worth menuju target Rp 100 juta akhir 2028.

**Konsep target — sengaja 2 sistem terpisah (keputusan owner, TASK-5):**
- **🏆 Main Milestone** — SATU angka besar (`settings.targetNetWorth`), benchmark net worth
  jangka panjang, pasif (progress otomatis dari `netWorthIDR()`, ga ada topup). Setup di
  Setting → "Main Milestone & Kurs". Ditampilkan di card Total Balance (Home) + banner Net
  Worth (Assets/Wealth).
- **🎯 Short Term Goals** — BISA BANYAK, topup/pencairan aktif (collection `goals`). Setup +
  kelola di `#/goals` (menu di Setting). Ditampilkan preview-nya di Home.
Jangan gabungin dua konsep ini atau rename salah satunya tanpa sadar bedanya — Milestone itu
"North Star" tunggal, Goals itu daftar target aktif yang bisa nabung/cair beneran.

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
js/recurring-sheet.js sheet "Awal Bulan": konfirmasi post recurring + opsi salin budget
js/utils.js           format, tanggal, toast, openSheet/closeSheet, escapeHtml, blur mode, hardRefresh
js/views/             home, transactions, budget, wealth, settings, accounts, categories, goals, recurring
sw.js                 service worker: precache shell, runtime cache gstatic+jsdelivr
```

Routing: hash (`#/home`). Nav: Home · History (transactions) · Assets (wealth) · Setting.
Budget/Akun/Kategori/Goals/Recurring = subpage di dalam Setting (punya `back` di ROUTES).

### Home page (`js/views/home.js`)

Urutan section (top→bottom): **Filter periode** (tabs Hari/Minggu/Bulan/Tahun + Custom range
via sheet date picker, state module-level `period`, ga persist ke Firestore) → **Card Total
Balance** (cash-only by default (`totalCashIDR()`); toggle "+ Assets" ganti ke `netWorthIDR()`
penuh — cash + assets + goal savings **− debt**, BUKAN cuma nambahin assets doang. Jangan lupa
subtract debt lagi kalau ada yang refactor bagian ini, pernah kelewat sebelumnya — plus
Income/Expense/Surplus yang ke-filter sesuai periode di atas, plus progress bar
**🏆 Main Milestone** di bagian bawah card — vs `netWorthIDR()`, target-nya sama dengan yang di
banner Wealth) → **Akun** (horizontal scroll saldo per akun) → **🎯 Short Term Goals** (preview
horizontal scroll, "Kelola →" ke `#/goals`) → **Budget bulan ini** (preview, "Kelola →" ke
`#/budget`) → **Transaksi terakhir** (di luar `.card`, sama pola header row-nya kayak
Akun/Goals/Budget — bukan section terpisah yang punya card sendiri; 3 terbaru, txRow()
di-share ke `transactions.js`).

Blur mode (toggle 👁️ di card Total Balance) nge-blur semua `<span class="blur-num">` (dihasilkan
`fmtIDR`/`fmtUSD` di `utils.js`) lewat CSS `body.blur-mode`, state di localStorage — bukan re-render.

## Data Model (Firestore `users/{uid}/`)

- `accounts` — kantong uang (bank/ewallet/cash/rdn/broker), currency IDR/USD, initialBalance.
  **Saldo TIDAK disimpan** — dihitung dari jurnal: initialBalance ± transaksi (lihat `accountBalances()`).
  Reconcile ("⚖️ Sesuaikan Saldo" di sheet edit akun, `accounts.js`) TIDAK overwrite saldo —
  bikin 1 transaksi adjustment (expense/income, kategori `cat_adjust_out`/`cat_adjust_in`)
  sebesar selisih aktual vs tercatat, biar tetap auditable di History.
- `categories` — {name, icon, type: expense|income, isPreset}. Preset awal via `seedIfNeeded()`
  (sekali doang, first-run); preset baru buat user lama via `ensurePresetCategories()` (tiap
  sesi, idempotent) — lihat Known Quirks. Ga bisa dihapus kalau masih dipakai transaksi
  (guard di `categories.js`).
- `transactions` — {date, month:"YYYY-MM", amount, type: expense|income|transfer, accountId,
  toAccountId?, toGoalId?, fromGoalId?, categoryId, note}. Transfer = 1 record, BUKAN expense.
  **Topup goal** = transfer, `toGoalId` diisi (bukan `toAccountId`) — `accountId` = akun SUMBER
  (ke-debit), ga ada akun yang ke-kredit. **Pencairan goal** = kebalikannya, `fromGoalId` diisi
  — `accountId` di sini malah jadi akun TUJUAN (ke-kredit), ga ada akun yang ke-debit (lihat
  `accountBalances()`). Jadi peran `accountId` kebalik tergantung arahnya — sengaja, biar field
  akun tetap satu & generic di seluruh app (filter History, txRow, dll) ga perlu tau bedanya.
  Dibuat/diedit lewat `openTopupSheet()`/`openWithdrawSheet()` di `goals.js`, BUKAN
  `openTxSheet()` generik di `tx-sheet.js` (yang itu ga ngerti `toGoalId`/`fromGoalId`).
- `budgets` — id deterministik `{month}_{categoryId}`.
- `assets` — saham IDX (quantity dalam **LOT**, ×100 lembar saat hitung nilai), US fractional shares,
  dll. `manualPrice` + `manualPriceUpdatedAt` + `priceSource`. `manualOnly:true` = skip auto-refresh.
- `debts` — outstanding, monthlyInstalment, dueDay, remainingMonths. Mengurangi net worth.
- `goals` — Short Term Goals. {name, targetAmount, targetDate? ("YYYY-MM"), color}. Bisa lebih
  dari satu (dikelola di `#/goals`, menu di Setting). **Sistem topup + pencairan**, bukan target
  pasif: saldo goal = topup − pencairan asli (`goalSavedIDR()`), bukan net worth. Goal saldo 0
  SETELAH pernah ada topup/pencairan → badge "Selesai 🎉" (bukan auto-delete, tetep bisa
  di-topup lagi). Goal yang punya riwayat topup ATAU pencairan ga bisa dihapus langsung (harus
  beresin transaksinya dulu di History) — pola sama kayak proteksi hapus akun. Beda konsep dari
  Main Milestone (`settings.targetNetWorth`) — lihat catatan di atas.
- `recurring` — {name, type, amount, accountId, toAccountId?, categoryId?, dayOfMonth (1–31),
  active, lastPostedMonth? ("YYYY-MM")}. Dikelola di `#/recurring`. Tiap app dibuka, item aktif
  yang `dayOfMonth` ≤ hari ini DAN `lastPostedMonth` ≠ bulan berjalan dianggap "jatuh tempo" →
  muncul sheet **Awal Bulan** (`recurring-sheet.js`) buat konfirmasi (checklist, default semua
  tercentang) + opsi salin budget bulan lalu kalau budget bulan ini kosong. **JANGAN AUTO-POST**
  — transaksi baru dibuat pas user klik "Catat Semua". Tanggal transaksi yang di-post pakai
  `dayOfMonth` template di bulan berjalan (bukan tanggal user konfirmasi) — representasi kejadian
  riil, bukan kapan usernya buka app. Edit template TIDAK reset `lastPostedMonth` (biar ga dobel
  post bulan yang sama). Sheet muncul maks 1x/hari kalau di-"Nanti"-in (flag tanggal di
  localStorage, key `fintrack_recurring_dismissed_date`), dipanggil sekali per sesi dari app.js.
- `snapshots/{YYYY-MM}` — net worth bulanan, di-upsert otomatis saat app dibuka (`upsertSnapshot`).
  Bisa juga di-backfill manual buat bulan pra-app lewat card "Snapshot Historis" di Setting
  (`{month, netWorth, manual:true}`, minimal field — chart Tren Net Worth cuma butuh `netWorth`
  + `month`/id). Cuma boleh untuk bulan < bulan berjalan (bulan berjalan wilayah `upsertSnapshot`).
- `settings/main` — targetNetWorth (= **Main Milestone**, dipakai card Total Balance Home DAN
  banner Wealth — SATU sumber, jangan bikin duplikat field), usdIdrManual,
  apiKeys:{itick, finnhub}, lastBackupAt.

Net worth = totalCashIDR + totalAssetsIDR + totalGoalSavingsIDR − totalDebtIDR (USD dikonversi
`effectiveRate()`). Goal savings dihitung terpisah dari `totalAssetsIDR()` (bukan di-fold ke situ)
biar tab Assets di Wealth (isinya cuma investasi) ga ikut kebawa angka goal — tapi tetep ditambah
sebagai baris terpisah "🎯 Goals" di breakdown Total tab Wealth biar rows-nya sum ke net worth.

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
- Dua mekanisme seeding kategori di `db.js`, sengaja beda: `seedIfNeeded()` = sekali doang
  (guard `settings.seeded`), buat kategori awal saat akun baru pertama kali dipakai.
  `ensurePresetCategories()` = jalan tiap sesi (`put()` id deterministik + merge, idempotent),
  buat nambahin kategori sistem baru (mis. Penyesuaian Saldo) ke user LAMA yang udah lewat
  seedIfNeeded. Kalau nambah kategori sistem baru lagi ke depannya, tambahin ke
  `ensurePresetCategories()`, jangan ke `PRESET_CATEGORIES`/`seedIfNeeded` (user lama ga bakal
  ke-migrasi).
- Chart.js dari jsdelivr CDN; kalau belum ke-cache dan offline, chart area menampilkan pesan fallback.
- iOS Safari bisa evict storage PWA — data master di cloud, jadi worst case re-sync saat login.
- `attachThousands()` memformat input ribuan live; parse balik pakai `parseAmount()`.
- **Tanggal kalender WAJIB pakai `toDateStr()`/`todayStr()` di `utils.js`** (local time, dari
  `getFullYear()/getMonth()/getDate()`) — **JANGAN** `new Date().toISOString().slice(0,10)` buat
  representasi "hari ini"/tanggal kalender. Di WIB (UTC+7) jam 00:00–07:00, `toISOString()`
  mundur satu hari (masih UTC kemarin) — pernah bikin transaksi default kecatat tanggal salah,
  `currentMonth()` salah bulan awal bulan (snapshot bisa nimpa bulan lalu), sheet Awal Bulan ga
  ke-trigger. `toISOString()` sendiri tetep valid buat timestamp MOMEN (`createdAt`,
  `lastBackupAt`, `exportedAt` di db.js/settings.js) — itu memang harus UTC/absolute, bukan
  tanggal kalender, jangan diubah. Kalau nambah kode baru yang butuh format Date → string
  tanggal, pakai `toDateStr(d)`, jangan bikin ulang pad/getFullYear manual (udah pernah
  ke-duplikasi di 3 file sebelum di-konsolidasi: utils.js, home.js, recurring-sheet.js).
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
- Transaksi dengan `toGoalId` (topup) atau `fromGoalId` (pencairan) HARUS selalu dibuka lewat
  `openTopupSheet()` / `openWithdrawSheet()` (goals.js), jangan lewat `openTxSheet()` generik
  (tx-sheet.js) — sheet itu cuma tau `toAccountId`, kalau transaksi ini ke-save ulang lewat situ
  field goal-nya bakal hilang (data ke-corrupt). Titik masuknya udah dijaga di `txRow()`
  (`home.js`, dipakai bareng `transactions.js`) — cek `t.toGoalId || t.fromGoalId` dulu sebelum
  decide sheet mana yang dibuka. Kalau nambah entry point baru buat klik transaksi (search, dll),
  inget guard ini juga.
- Logic salin budget bulan lalu cuma ada SATU implementasi: `copyBudgetFromLastMonth()`,
  exported dari `views/budget.js`, dipakai tombol "⧉ Salin bulan lalu" DAN sheet Awal Bulan
  (`recurring-sheet.js`). Jangan re-implement inline lagi di tempat lain.

## Roadmap (belum dibuat, urutan prioritas)

1. Import CSV mutasi bank; laporan tahunan; enkripsi backup (Web Crypto)
2. Harga emas & NAV reksa dana: BELUM ada API gratis+CORS yang stabil → tetap manual

## Konteks Owner (untuk fitur/copy)

Usia 26, fase asset accumulation. Gaji ~9jt/bln (gajian tgl 28). Akun: BCA (payroll),
bank digital (operational, bunga 6% pa), RDN, Bibit (RDPU), Pluang (US stocks).
Portfolio: BBCA/BBRI/ADRO/WBSA (IDX), VOO/SCHD (US). Debt aktif: Tokopedia CC (tgl 15),
Shopee BNPL (tgl 11, lunas Agt 2026). Target: 100jt aset akhir 2028, debt-free Jan 2027.
