# FinTrack — Project Context

Personal finance tracker PWA milik satu user (owner repo). Live di https://xiesandi.cyou/fintrack
(GitHub Pages, custom domain, subpath). Track expense harian, budget bulanan, assets, debt,
net worth menuju 🏆 Main Milestone.

File ini = aturan **"apa yang berlaku SEKARANG"**, ringkas. Narasi "kenapa" (insiden, keputusan
desain, alternatif yang ditolak) ada di `DECISIONS.md` — kalau ada bullet yang bilang "lihat
DECISIONS.md", ceritanya di sana. Backlog + roadmap: `TASKS.md`. Konteks personal owner:
`CLAUDE.local.md` (lihat bagian paling bawah).

**Dua konsep target, SENGAJA terpisah — jangan digabung/di-rename:**
- **🏆 Main Milestone** — SATU angka (`settings.targetNetWorth`), benchmark net worth pasif
  (progress dari `netWorthIDR()`). Setup di Setting; tampil di card Total Balance (Home) +
  banner Net Worth (Wealth).
- **🎯 Short Term Goals** — banyak, topup/pencairan aktif (collection `goals`, `#/goals`).

## Stack & Prinsip (JANGAN diubah tanpa diskusi)

- **Vanilla JS (ES modules) + plain CSS, ZERO build step.** No framework/bundler/npm. Push ke
  `main` = deploy.
- **Firebase**: Auth (Google) + Firestore `persistentLocalCache` = offline-first. Path
  `users/{uid}/...`, Security Rules per-uid. Config di `js/firebase.js` sengaja hardcoded
  (client-side, bukan secret; proteksi = rules + authorized domains + API key referrer).
- **Semua path relative (`./`)** — hosting di subpath `/fintrack/`.
- UI: Indonesia santai (lo/gue). Uang: `Intl id-ID` → "Rp 1.500.000".
- **Copy UI minim.** App satu user yang hafal fiturnya — JANGAN nambah teks tutorial. Yang boleh
  panjang cuma KONDISI/INSIGHT data (pace milestone, sisa limit, preview aksi destruktif, hasil
  integritas, peringatan state).
- **Tema calm dark** (`--bg #101318`; aksen `--green #8fbe9f`, `--red #d99494`, `--blue #8bacd0`,
  `--yellow #d9bc7f`) — jangan balik ke neon. Var: `--x` teks/garis, `--x-dim` background aktif/
  badge, `--x-edge` border aktif. Inline style JS pakai `var(--x)`; **Chart.js WAJIB literal hex**
  (canvas ga bisa resolve CSS var) — ganti palet = update dua-duanya.
- **Layout mobile-first + satu breakpoint `@media (min-width: 860px)`** (blok bawah
  `css/style.css`): `.view` melebar ke `--maxw`, header pakai `.header-inner`, bottom nav jadi
  pill, sheet jadi modal tengah (`popin`), slider horizontal jadi grid. Hover dikurung
  `@media (hover:hover) and (pointer:fine)`.

## Arsitektur

```
index.html            shell: header, #view, FAB, bottom nav, sheet, toast, banner update SW
css/style.css         tema + breakpoint desktop
js/app.js             auth flow, hash router (ROUTES), month picker, SW register + banner update
js/firebase.js        init SDK via CDN + offline persistence
js/store.js           state global + onSnapshot listeners; wrapper tipis ke calc.js (nyuntik
                       `state` & `currentMonth()`) — view WAJIB import derived lewat sini
js/calc.js            kalkulasi MURNI — ga import Firebase, ga baca wall-clock (nowMonth/today
                       masuk sebagai parameter); ditest tests/calc.test.mjs
js/db.js              repository: CRUD generik + hook efek debt/asset/attachment, seeding, snapshot
                       bulanan, backup/restore, bulkDelete, deleteAssetKeepHistory, attachments
js/prices.js          auto price: TradingView (IDX, tanpa key), Finnhub (US), CoinGecko (crypto)
js/kurs.js            kurs USD/IDR auto (frankfurter.app), cache localStorage
js/tx-sheet.js        sheet tambah/edit transaksi generik (quick-add)
js/recurring-sheet.js sheet "Awal Bulan": konfirmasi post recurring + salin budget
js/report-md.js       buildMonthlyReport(month) → laporan .md buat di-paste ke AI
js/integrity.js       scanIntegrity(state) → cek referensi yatim, read-only
js/utils.js           format, tanggal, toast, sheet, escapeHtml, blur mode, copyText, hardRefresh,
                       compressImage
js/views/             home, transactions, budget, wealth, settings, accounts, categories, goals,
                       recurring, danger
tests/calc.test.mjs   smoke test calc.js (node tests/calc.test.mjs) — bukan runtime, GA di PRECACHE
tests/precache.test.mjs cek PRECACHE sw.js lengkap dua arah (node tests/precache.test.mjs)
sw.js                 precache shell, runtime cache gstatic+jsdelivr
```

Routing hash (`#/home`). Nav: Home · History · Assets (Wealth: sumtab Total · Assets · Liquid ·
Debt · Claim) · Setting. Budget/Akun/Kategori/Goals/Recurring/Danger = subpage Setting (`back`
di ROUTES). `#/budget` & History satu-satunya route ber-month-picker (`month:true`).

**Home** (`views/home.js`), top→bottom: filter periode (state module-level) → card Total Balance
(default `totalCashIDR()`; toggle "+ Assets" = `netWorthIDR()` PENUH, termasuk −debt) + income/
expense/surplus periode + progress 🏆 Milestone → Akun (scroll) → 🎯 Goals preview
(`activeGoals()`) → Budget preview → 3 transaksi terakhir (`txRow()`, di-share ke
`transactions.js`).

**Blur mode** (👁️ di card Total Balance, state localStorage, TANPA re-render):
- Mask asterisk **panjang tetap** di CSS (`body.blur-mode .blur-num::after`), teks asli di
  `<span class="bn-real">` → `display:none`. JANGAN nulis `<span class="blur-num">` manual —
  SELALU `blurNum(text)` (utils.js). `fmtIDR`/`fmtUSD`/`fmtMoney` udah auto-blur.
- `fmtShort()` **TIDAK** auto-blur (dipakai teks non-DOM) — caller DOM WAJIB `blurNum(fmtShort(n))`.
- Jumlah unit asset (lot/lembar/share) WAJIB ikut di-blur di tampilan read-only.
- Chart.js: pasang **DUA-DUANYA** `blurTick(fmt)` (ticks.callback) DAN `blurMoneyTooltip`
  (wealth.js), keduanya balikin `BLUR_MASK`. Redraw lewat event `blurchange` (dispatch
  `setBlurred()`, listener module-scope wealth.js). Doughnut budget: tooltip persen doang.
- Mekanisme lengkap & bocor yang pernah kejadian: `DECISIONS.md`.

## Data Model (Firestore `users/{uid}/`)

### `accounts`
`{name, type: bank|ewallet|cash|rdn|broker|credit, currency: IDR|USD, initialBalance, color,
accountNumber?, creditLimit?, isArchived?}`.
- **Saldo TIDAK disimpan** — `accountBalances()` = initialBalance ± jurnal. Satu-satunya
  `patch("accounts")` = form Edit Akun. Reconcile ("⚖️ Sesuaikan Saldo") TIDAK overwrite: bikin 1
  transaksi adjustment (`cat_adjust_out`/`cat_adjust_in`) sebesar selisih. Saldo aktual boleh
  MINUS (`attachThousands(input, {allowNegative:true})` + tombol ±; default `attachThousands`
  tetap strip minus). Buat `credit`, input reconcile = "tagihan terpakai" (positif = utang,
  internal dibalik jadi saldo negatif).
- **`accountNumber`** (string apa adanya, JANGAN `Number()`): cuma hidup di dokumen + `#/accounts`
  (`acctNumberRow()` + copy). **DILARANG** masuk `breakdown.accounts` snapshot (db.js) dan
  `buildPosition()` (report-md.js) — dua mapping itu ambil field satu-satu, bukan spread; ada
  komentar guard. Backup JSON BOLEH bawa (itu restore lokal). Ikut blur, copy selalu nilai asli.
- **`isArchived`** akun = ditutup: `activeAccounts()` dipakai LANGSUNG di `totalCashIDR()`
  (saldo berhenti dihitung). Beda dari goal (lihat `goals`).
- **Tipe `credit`** (kartu kredit): utang = saldo negatif, DERIVED — bukan entity `debts`. Belanja
  CC = expense biasa. **Debt path** (v2, alasan: `DECISIONS.md`): `totalCashIDR()` EXCLUDE bagian
  negatif akun credit (positif/overpay tetap cash), `totalDebtIDR()` = Σ`debtOutstanding()` +
  `totalCreditDebtIDR()`. Helper `isCreditAccount`/`creditUsed`/`creditRemaining` (null = tanpa
  limit, bukan 0) DIDEFINISIKAN SEBELUM `totalCashIDR()` di calc.js — jangan taruh definisi
  baru yang butuh helper ini sebelum bloknya. UI TIDAK pernah nampilin saldo CC signed polos —
  selalu Terpakai/Limit/Sisa + progress (`p-red ≥100, p-yellow ≥90`). "💳 Bayar Tagihan"
  (`openPayCreditSheet()`) = transfer generik cash→CC, sumber dibatasi se-currency, overpay boleh
  (warning). Warning over-limit di `openTxSheet()` SETELAH tersimpan (toast, non-blocking), ikut
  ngitung biaya tambahan. Wealth: tab Liquid ga nampilin CC; tab Debt section "🪪 Kartu Kredit"
  (klik → `openAcctSheet()`), breakdown Total misahin "🪪 Kartu Kredit" dari "💳 Cicilan"
  (`debtsOnly = totalDebtIDR() − totalCreditDebtIDR()`). Cicilan 0% CC kalau nanti ada = konsep
  terpisah dari `debtId`, jangan dicampur.

### `categories`
`{name, icon, type: expense|income, isPreset}`. `seedIfNeeded()` = sekali (first-run);
`ensurePresetCategories()` = tiap sesi, idempotent (`put()` id deterministik) — **kategori
sistem baru tambahin ke sini**, bukan `PRESET_CATEGORIES`. Ga bisa dihapus kalau dipakai
transaksi. Preset sistem: `cat_adjust_out/in`, `cat_fee`, `cat_bunga`, `cat_cicilan`.

### `transactions`
`{date, time?, month, amount, type: expense|income|transfer, accountId, toAccountId?, toAmount?,
fxRate?, toGoalId?, fromGoalId?, categoryId, debtId?, debtDir?, assetId?, assetDir?, assetQty?,
assetPrice?, assetDeleted?, assetSnapshot?, feeOfTxId?, attachmentId?, linkUrl?, note}`. Semua
field baru additive — schemaVersion TIDAK naik.
- **Transfer = 1 record**, bukan expense. **Peran `accountId` KONDISIONAL** — WAJIB dicek sebelum
  ngagregasi arus kas per akun (`accountBalances()` = referensi):
  - `toAccountId` → akun-ke-akun: `accountId` didebit, tujuan dikredit `toAmount ?? amount`.
  - `toGoalId` (topup) / `assetId`+`assetDir:"buy"` (beli, kasih pinjaman claim) → `accountId`
    DIDEBIT, ga ada yang dikredit.
  - `fromGoalId` (pencairan) / `assetId`+`assetDir:"sell"|"redeem"` (jual, terima pembayaran
    claim, cairkan pokok bond) / `debtId`+`debtDir:"borrow"` (pinjaman masuk) → `accountId`
    DIKREDIT.
- **Lintas mata uang** (`toAmount`, `fxRate`): `amount` currency sumber, `toAmount` nominal
  diterima currency tujuan, `fxRate` SELALU "1 USD = X IDR" apapun arahnya. Field Kurs + Diterima
  di `openTxSheet()` cuma muncul kalau currency beda, saling ngitung, disimpan `null` kalau
  se-currency. Recurring lintas currency ngitung `toAmount` pakai `effectiveRate()` saat posting.
  Cuma transfer akun-ke-akun (goal/asset pakai currency akun sumber).
- **`time`** ("HH:MM"): entry baru default `nowTimeStr()`, bisa diubah. Fallback
  `DEFAULT_TX_TIME` = "00:01" buat data lama & posting recurring. Sort CLIENT-SIDE
  `compareTxDateTime()` (calc.js) di `track()` store.js — **JANGAN tambah `orderBy("time")`**
  (Firestore nge-exclude dokumen tanpa field itu). Pola `mapFn` ini WAJIB buat secondary sort
  key baru. `txRow()` nampilin `· HH:MM` cuma kalau field ada.
- **Biaya tambahan** (`feeOfTxId`) = transaksi expense TERPISAH yang nunjuk induk — **JANGAN
  refactor jadi field `fee`** (semua agregasi otomatis jalan karena dia expense beneran; alasan:
  `DECISIONS.md`). `accountId/date/time` biaya ngikut induk (di-sync pas edit di `openTxSheet()`),
  nominal & kategori sendiri (default `cat_fee`). Checkbox cuma expense & transfer. Biaya ga bisa
  punya biaya (nesting diblok → cascade delete 1 level, hook `remove()`). `txRow()` badge
  "biaya" tanpa lookup induk.
- **Topup/pencairan goal** dibuat lewat `openTopupSheet()`/`openWithdrawSheet()` (goals.js);
  **beli/jual asset** lewat `openAssetBuySheet()`/`openAssetSellSheet()` (wealth.js) — `assetQty`/
  `assetPrice` native unit (LOT buat `stock_id`). **Edit transaksi ber-`assetId` TIDAK didukung**
  (weighted avg ga bisa di-reverse aman) — detail read-only + Hapus (reverse `quantity` exact,
  `avgBuyPrice` TIDAK di-reverse). Salah catat → hapus + catat ulang.
- **Guard entry point**: klik transaksi manapun WAJIB lewat `openTxDetail()` (home.js) — dia
  routing `debtDir:"borrow"` → `openDebtBorrowSheet()`, `assetDir:"redeem"` →
  `openBondRedeemSheet()`, `assetId` → buy/sell sheet, goal → topup/withdraw, sisanya
  `openTxSheet()` generik (yang ga ngerti field-field khusus itu — kalau ke-save lewat situ
  field-nya hilang). Referensi orphan → fallback generik. `assetForTx(t)` balikin pseudo-asset
  dari `assetSnapshot` kalau asset-nya udah dihapus.
- `attachmentId`/`linkUrl`: foto/link bukti — lihat `attachments` & `assets` tipe `receivable`.
  `openTxSheet()` nampilin keduanya read-only kalau ada.

### `budgets`
Id deterministik `{month}_{categoryId}`. `#/budget` juga punya doughnut "🥧 Per Kategori"
(`spentByCategory()`, 7 slot warna + abu-abu buat `cat_adjust_out` & "Lainnya"). Salin bulan lalu
= SATU implementasi `copyBudgetFromLastMonth()` (budget.js), dipakai tombol & sheet Awal Bulan.

### `assets`
`{type, symbol, name, quantity, avgBuyPrice, currency, manualPrice, manualPriceUpdatedAt,
priceSource, manualOnly, qtyless, ...field per tipe}`. Tipe: `stock_id` (qty LOT ×100),
`stock_us`, `mutual_fund`, `deposito`, `gold`, `crypto`, `bond`, `jht`, `receivable`, `capex`, `other`.
`AUTO_TYPES` (prices.js) = stock_id/stock_us/crypto; `manualOnly:true` skip refresh.
- **`nowMonth` WAJIB** dikirim ke `assetValueIDR()`/`totalAssetsIDR()`/`netWorthIDR()` — caller
  lewat store.js yang nyuntik `currentMonth()`.
- **Hapus asset ber-transaksi**: BOLEH kalau nilai udah 0, lewat `deleteAssetKeepHistory()`
  (db.js, raw batch): transaksi TIDAK ikut dihapus, ditandai `assetDeleted:true` + `assetSnapshot`
  ({symbol,name,type,currency,qtyless,debtorName}). Nilai > 0 diblok. Tanpa transaksi →
  `remove()` biasa. Guard link goal tetap. GA ADA arsip asset (kecuali `receivable`). Alasan:
  `DECISIONS.md` "Batch bugfix 2026-09".
- **`capex`** (barang susut): nilai auto `avgBuyPrice × (1 − depreciationPctMonth)^bulan sejak
  purchaseDate` (`capexLocalValue()`). `quantity` = 1, `avgBuyPrice` = harga beli (reuse → P&L
  otomatis = penyusutan). Field: `purchaseDate`, `depreciationPctMonth` (desimal, form persen).
  Ga auto-refresh, ga ada Catat Pembelian/Penjualan. Toggle `settings.includeCapexInNetWorth`
  (checkbox Wealth → Total, default FALSE) — exclude CUMA lewat `netWorthFromParts()`,
  `totalAssetsIDR()` tetap termasuk. Breakdown Total: "📈 Assets" SELALU exclude CAPEX (& claim),
  baris "🏗️ CAPEX" cuma kalau ON. Snapshot: `totalCapex` top-level + `purchaseDate`/
  `depreciationPctMonth` di breakdown (lama → 0/null).
- **`bond`** (SBN ritel): nilai = `manualPrice > 0 ? manualPrice : principal` (`manualPrice` =
  nilai pasar ABSOLUT, bukan per-unit); cost = `principal` (P&L 0 di par = benar). Field:
  `principal` (WAJIB), `maturityDate` (WAJIB), `couponRatePA` (desimal), `couponPeriodMonths`,
  `couponAccountId`, `maturityAccountId`, `purchaseDate` (`issueDate` cuma fallback data lama di
  `bondNextCouponHint()`), `redeemed`. `quantity` 1, currency IDR, `symbol` = series name. **Kupon TIDAK dihitung otomatis** (keputusan owner, `DECISIONS.md`) —
  `bondNextCouponHint()` cuma estimasi teks. Aksi: "💰 Catat Kupon Masuk" (`openBondCouponSheet()`) = income biasa
  (`cat_bunga`, TANPA assetId); "🏁 Cairkan Pokok" (`openBondRedeemSheet()`, exported) = transfer
  `assetDir:"redeem"` (tanpa assetQty/Price), sheet nge-patch `redeemed:true` sendiri, reversal
  di `applyAssetQtyEffect()` (balikin `redeemed:false`). `redeemed` → value/cost 0, doc TETAP
  ADA, difilter dari list/snapshot/report. Integrity punya cabang khusus arah `"redeem"` — arah
  baru = update integrity juga. Bond SENGAJA ga masuk recurring.
- **`jht`** (Jaminan Hari Tua): saldo lump-sum, nilai = `manualPrice` apa adanya
  (`jhtLocalValue()`/`jhtValueIDR()`, `quantity` dipaksa 1 & diabaikan), diupdate MANUAL tiap
  bulan lewat form Edit Asset (field "Saldo JHT sekarang", `manualPriceUpdatedAt` ikut). TIDAK
  ada harga beli (`avgBuyPrice` dipaksa 0, field di-hide) dan kenaikan saldo BUKAN gain: cost =
  value → P&L selalu 0 (`assetRow()` nampilin "saldo", report section 6 Qty/Avg/P&L "—"). Ga ada
  Catat Pembelian/Penjualan (iuran potong gaji, ga lewat akun manapun), BUKAN `qtyless`, ga
  auto-refresh, di-exclude dari dropdown DCA. Ikut net worth & tab Assets penuh, tanpa toggle.
- **`qtyless`** ("Jumlah N/A", toggle buat `mutual_fund`/`deposito`/`gold`/`other`): `quantity`
  dipaksa 1 SELAMANYA → formula generik otomatis `manualPrice` = nilai total, `avgBuyPrice` =
  modal total (TANPA cabang calc khusus). Trade lewat `openQtylessTradeSheet()` (dispatch otomatis
  dari `openAssetBuySheet/SellSheet`): beli nambah nilai+modal, jual ngurangin nilai doang;
  transaksi TANPA assetQty/assetPrice. Reversal `applyAssetQtyEffect()` cabang qtyless; bulkDelete
  agregasi `netValueAmount`/`buyAmount`; integrity skip check qty-vs-transaksi, flag `quantity
  !== 1`. Toggle ON dari qty > 1 auto-konversi per-unit → total; OFF ga di-reverse. Rasional:
  `DECISIONS.md` "Catatan desain yang dipindah".
- **`receivable`** (🤝 **UI: "Claim"** — semua teks user; identifier tetap receivable/piutang):
  REUSE mesin `qtyless` (dipaksa true, checkbox di-hide). `manualPrice` = SISA, `avgBuyPrice` =
  total dipinjamkan (default = sisa kalau kosong). Field: `debtorName` (WAJIB), `dueDate?`,
  `isArchived?`. `symbol` di-hide. Cost = value → **P&L selalu 0**. Tab sendiri "Claim"
  (`renderReceivables()`, `groupTab:"receivable"`, `.sumtabs` 5 kolom); tab Assets & sumtab
  Assets EXCLUDE claim, `totalAssetsIDR()` tetap termasuk. "＋ Tambah Claim" →
  `openNewReceivableSheet()`: nominal + siapa + **Dari Akun (WAJIB)** + tgl/jam + tgl tagih +
  catatan + foto + link → bikin asset DAN transaksi `assetDir:"buy"` sekaligus. Klik item →
  `openReceivableDetailSheet()` (progress, riwayat semua transaksi, tombol Terima Pembayaran /
  Kasih Pinjaman / Edit). Trade lewat `openQtylessTradeSheet()` di-relabel (object `L`): "🤝 Kasih
  Pinjaman" = buy, "💵 Terima Pembayaran" = sell (guard ≤ sisa) — JANGAN bikin jalur tulis
  terpisah. **GA BISA DIHAPUS, cuma arsip** (`isArchived`, KHUSUS tipe ini): nilai → 0
  (`receivableLocalValue()`), keluar dari snapshot/report, section "📦 Arsip" di bawah tab.
  Toggle `settings.includeReceivablesInNetWorth` (checkbox Wealth → Total, **default TRUE**;
  `includeReceivablesSetting()`: cuma `=== false` yang exclude) — `netWorthFromParts(parts,
  includeCapex, includeReceivables = true)`, pola persis capex; `snapshotNetWorth()`/
  `netWorthComposition()` param ke-3/ke-4; chart & report ngikut toggle SEKARANG buat semua
  garis/angka. Snapshot: `totalReceivables` + `debtorName`/`dueDate` di breakdown. `txRow()`:
  pembayaran tampil kayak income (+ hijau), pinjaman keluar kayak expense — TAMPILAN doang, tipe
  tetap transfer (ga masuk `monthSummary()`). Integrity: dueDate lewat & sisa > 0, qtyless bukan
  true, sisa > total dipinjamkan. Ga auto-refresh, di-exclude dari dropdown DCA. Alasan semua
  keputusan: `DECISIONS.md` "Piutang v2".

### `attachments/{id}`
`{txId, mime, data (data URL JPEG), createdAt}`. Foto bukti — CUMA jalur Claim & Hutang.
`compressImage()` (utils.js) target ≤ ~450KB PANJANG DATA URL (jangan dinaikin mepet 1 MiB —
foto ikut cache offline Firestore). db.js `addAttachment()` (upload SETELAH transaksi tersimpan,
patch `attachmentId`), `getAttachment()` on demand (TIDAK di-listen ke state),
`removeAttachment()`. Ikut kehapus di hook `remove()` & `bulkDelete()`, ikut `COLLECTIONS`
backup. BUKAN Firebase Storage & BUKAN field di transaksi (`DECISIONS.md` "Piutang v2").
Link bukti: `linkUrl` di transaksi, `normalizeLink()` (tanpa skema → https://, cuma http/https),
anchor `target=_blank rel=noopener`, bisa nyusul dari detail (`renderTxLink()`).

### `debts`
`{name, totalOutstanding, monthlyInstalment, dueDay, remainingMonths, isArchived?}`. Cicilan
TETAP, beda dari CC (revolving, derived). Mengurangi net worth via `debtOutstanding()` (0 kalau
arsip).
- **Arah transaksi ber-`debtId`** — SATU sumber `isDebtBorrow(t)`/`debtTxDelta(t)` (calc.js):
  `debtDir:"borrow"` = transfer, dana MASUK (akun dikredit, BUKAN income), outstanding NAIK,
  `remainingMonths` ga disentuh; `debtDir` kosong = pembayaran (expense biasa, outstanding turun,
  sisa bulan −1). Hook `applyDebtEffect()`/`handleDebtPatch()` (db.js) di `add/patch/remove` —
  JANGAN mutasi debt manual di sheet, jangan hitung sign manual.
- **GA BISA DIHAPUS, cuma arsip** (checkbox di `openDebtSheet()`; `activeDebts()` filter tab
  Debt/snapshot/report/dropdown "Potong hutang?"; `brokenReason()` recurring nge-flag). Lunas =
  badge, beresin lewat arsip.
- Tab Debt: klik → `openDebtDetailSheet()` (progress, riwayat, tombol Bayar Cicilan / Tambah
  Pinjaman / Edit; arsip di section bawah). "＋ Tambah Hutang" → `openNewDebtSheet()`: outstanding
  = nominal LANGSUNG + checkbox "💵 Dana pinjaman masuk ke akun" (default ON; OFF buat BNPL) →
  transaksi borrow ditulis `add(..., {skipDebtEffect:true})` (bypass eksplisit, kalau hook jalan
  dobel). "💵 Bayar Cicilan" (`openDebtPaySheet()`) = expense ber-debtId + kategori (default
  `cat_cicilan`) + foto/link; jalur lama "Potong hutang?" di `openTxSheet()` tetap jalan. "➕ Tambah
  Pinjaman" (`openDebtBorrowSheet()`, exported, dipakai `openTxDetail()`). Pembayaran TETAP
  expense (masuk cashflow/budget) — alasan `DECISIONS.md` "Hutang v2".

### `goals`
`{name, targetAmount, targetDate? ("YYYY-MM"), color, linkedAssetIds?, isArchived?}`. Saldo =
topup − pencairan (`goalSavedIDR()`). Ga bisa dihapus kalau punya riwayat topup/pencairan.
**GA ADA status "Selesai 🎉"** (`DECISIONS.md`).
- **Link asset** (`linkedAssetIds`, checkbox di Edit Goal): `goalProgressIDR()` = saved +
  `goalLinkedAssetsValueIDR()` buat TAMPILAN; **`totalGoalSavingsIDR()` TETAP murni
  `goalSavedIDR()`** (asset ter-link udah di `totalAssetsIDR()`, nambahin = double count).
  Progress gabungan **DILARANG tampil tanpa breakdown** tunai vs aset di semua tempat (goals.js,
  home.js, report section 1 & 8) — `goalDisplayStats(g)` (goals.js) satu sumber stats. "💸
  Cairkan" pakai `saved > 0`. Satu asset boleh di-link ke banyak goal (nilai penuh masing-masing).
  Asset ter-link ga bisa dihapus (lepas dulu). Snapshot nyimpen `linkedValue` terpisah dari `saved`.
- **Arsip goal ≠ arsip akun**: uangnya TETAP dihitung net worth (`totalGoalSavingsIDR()` ga
  difilter). `activeGoals()` CUMA filter tampilan (Home preview, report section 8 + catatan kalau
  ada saldo arsip, `breakdown.goals` snapshot). `#/goals` nampilin semua (flat + badge). Arsip:
  Topup disembunyiin, Cairkan tetap kalau `saved > 0`.

### `recurring`
`{name, type, amount, accountId, toAccountId?, toGoalId?, assetId?, categoryId?, debtId?,
dayOfMonth, active, lastPostedMonth?}`. Sheet **Awal Bulan** (`recurring-sheet.js`, sekali per
sesi, dismiss maks 1x/hari via localStorage `fintrack_recurring_dismissed_date`) buat item aktif `dayOfMonth` ≤ hari ini &
`lastPostedMonth` ≠ bulan berjalan. **JANGAN AUTO-POST** — nunggu "Catat Semua". Tanggal post =
`dayOfMonth` (di-clamp `daysInMonth()`), `time` = `DEFAULT_TX_TIME`. Transfer ke goal
(`toGoalId`) posting-nya identik `openTopupSheet()`. **DCA asset** (`assetId`) TIDAK auto-post:
baris tanpa checkbox + tombol "Catat pembelian →" → `openAssetBuySheet(asset, null, {prefillAmount,
prefillAccountId, prefillDate, onSaved})`, `lastPostedMonth` di-patch CUMA lewat `onSaved`.
"Catat Semua" disembunyiin kalau semua item due DCA. Edit template TIDAK reset `lastPostedMonth`;
`bulkDelete()` nge-reset kalau bulannya masuk scope. `brokenReason()` (referensi arsip/kehapus,
termasuk debt arsip) → item ga bisa dicentang, badge di `#/recurring`, item lain tetap jalan.
Bond SENGAJA ga diintegrasikan (`DECISIONS.md`).

### `snapshots/{YYYY-MM}`
`upsertSnapshot()` (db.js) jalan sekali per sesi, **cuma kalau online**, SELALU `currentMonth()`,
TIDAK ada backfill retroaktif (konsekuensi desain, jangan ditutupin — `DECISIONS.md`). Top-level:
`totalCash/totalAssets/totalCapex/totalReceivables/totalGoalSavings/totalDebt/netWorth` (field
baru → lama fallback 0) + `breakdown` per item (angka mentah): `accounts` (+`creditLimit`),
`assets` (+field capex/bond/receivable, `qtyless`; exclude bond redeemed, claim arsip), `debts`
(`activeDebts()`), `goals` (`activeGoals()`, +`linkedValue`), `rate`. Backfill manual "Snapshot
Historis" (Setting) = `{month, netWorth, manual:true}` TANPA breakdown, cuma bulan < berjalan.
"🏗️ Backfill CAPEX ke Snapshot Lama" (`previewCapexBackfill()`/`backfillCapexToSnapshots()`,
satu fungsi matching buat preview & eksekusi) ngisi `totalCapex` snapshot lama dari
`breakdown.assets` yang cocok symbol — TIDAK ngubah `type` historis, skip snapshot tanpa breakdown.

### `settings/main`
`targetNetWorth` (Milestone, SATU sumber Home + Wealth), `targetDate?` ("YYYY-MM", buat pace),
`usdIdrManual`, `apiKeys:{finnhub}`, `lastBackupAt`, `projectionRateA/B` (desimal, default
0.05/0.07, diubah dari Setting ATAU tab Proyeksi — field sama), `includeCapexInNetWorth` (default
false), `includeReceivablesInNetWorth` (default true), `seeded`.
`milestoneProgress(state, nowMonth)` (calc.js) → `{target, nw, pct, achieved, hidden}` +
field pace (`monthsLeft`, `neededPerMonth`, `avgSurplus3m`, `onTrack`) yang **SENGAJA ga ada**
kalau ga relevan (targetDate kosong / achieved / `targetDatePassed` / belum ada data surplus —
jangan ngarang on-track). `hidden` kalau target 0 (bukan div-by-zero). `achieved` → bar emas +
nudge set milestone baru (target ga auto-ubah). `milestonePaceLine(mp)` (utils.js) SATU formatter
buat Home, Wealth, report (pace SELALU dari posisi terkini).

### Formula net worth
`netWorthFromParts({cash, assets, capex, receivables, goalSavings, debt}, includeCapex,
includeReceivables = true)` (calc.js, PURE, tanpa `state`) = cash + assets + goalSavings − debt,
minus capex/receivables kalau toggle OFF. `assets` di sini RAW (termasuk capex & claim).
`netWorthIDR()` wrapper live; `snapshotNetWorth(s, ...)` dari total* mentah snapshot (fallback
`s.netWorth` kalau snapshot lama tanpa totals); `netWorthComposition(prev, curr, ...)` balikin
KONTRIBUSI siap-jumlah (`assets` exclude capex & receivables, `debt` udah dinegasi, `total`
dihitung langsung dari `netWorthFromParts`) — caller TINGGAL JUMLAH, jangan sign-flip manual
(riwayat bug: `DECISIONS.md` TASK-1). Goal savings = `goalSavedIDR()` murni. USD ×
`effectiveRate()` (manual > auto > 16000).

## ATURAN WAJIB saat mengubah kode

1. **Tiap deploy: naikin `CACHE_VERSION` di `sw.js`.** File baru masuk `PRECACHE` — cek
   `node tests/precache.test.mjs` (bump versinya tetap manual).
2. Semua akses Firestore lewat `js/db.js` (`add/put/patch/remove`) — jangan `setDoc` di view.
3. View re-render otomatis via `store.on()` — jangan manipulasi DOM manual abis save; cukup
   tutup sheet + toast.
4. User input SELALU `escapeHtml()` sebelum innerHTML.
5. Fitur inti harus jalan **offline** (Firestore persistence).
6. Dependency eksternal cuma via CDN + di-cache runtime `sw.js`.
7. Harga asset SELALU tampil dengan "per {tanggal}".
8. Nyentuh `js/calc.js` → `node tests/calc.test.mjs` harus hijau. Kalkulasi baru taruh di
   calc.js (pure, `nowMonth`/`todayStr` sebagai parameter) + test, bukan di store.js/view.
9. `schemaVersion` (`exportAll`/`importAll`) naik CUMA kalau backup lama jadi ga valid — field
   opsional/additive ga perlu.
10. **Tanggal kalender WAJIB `toDateStr()`/`todayStr()`** (local). JANGAN
    `toISOString().slice(0,10)` (bug WIB 00:00–07:00, `DECISIONS.md`). `toISOString()` tetap buat
    timestamp momen (`createdAt`, `lastBackupAt`, `exportedAt`).
11. Angka di teks/file (report .md, toast) pakai `fmtIDRPlain()`/`fmtMoneyPlain()`, BUKAN
    `fmtIDR()` (wrapper HTML blur).
12. Data personal owner DILARANG di file yang di-commit — lihat section Konteks Owner di bawah.

## Efek samping & jalur bypass (db.js)

Hook di `add()`/`patch()`/`remove()` generik: `applyDebtEffect()`/`handleDebtPatch()` (arah dari
`debtTxDelta()`), `applyAssetQtyEffect()` (HANYA `remove()`: reverse qty / nilai qtyless / flag
redeemed), hapus `attachments` + transaksi biaya ikut `remove()`. Sheet ga perlu tau.
**Bypass yang SENGAJA** (raw batch atau flag eksplisit) — kalau nambah jalur tulis massal baru,
ikutin pola ini, jangan bikin pattern keempat:
- `add(name, data, {skipDebtEffect:true})` — cuma `openNewDebtSheet()`.
- `deleteAssetKeepHistory()` — cuma patch flag.
- `importAll()` — nilai di backup udah final, hook = double count.
- `bulkDelete()` — efek debt/asset dikembalikan tapi DIAGREGASI per entity (satu patch), skip
  kalau Reset Total. Preview & eksekusi SATU scope (`bulkDeleteScope()`).
Kenapa hook: `DECISIONS.md` "efek debt/asset dipusatkan sebagai hook".

## Known Quirks (aturan operasional)

- **TradingView scanner** (IDX, `fetchIDX`): POST `scanner.tradingview.com/global/scan`, TANPA
  key, data delay ~10 menit (`delayed_streaming_600` — wajar beda sama app broker). **JANGAN set
  header `Content-Type: application/json`** (bukan CORS-safelisted → preflight
  ke-block; default `text/plain` jalan). Endpoint unofficial, risiko diterima — kalau harga IDX
  berhenti update, cek ini dulu; provider pengganti WAJIB dites pakai key asli, bukan marketing
  page (`DECISIONS.md`). `refreshPrices()` surface error mentah per provider ke toast
  (`errors: {idx, us, crypto}`) — pertahankan buat provider baru. CoinGecko: satu request batch.
- **Service Worker update**: register `{updateViaCache:"none"}`. GitHub Pages cache `sw.js`
  4 jam. **JANGAN** cache-buster `?v=` di URL registrasi, **JANGAN** `skipWaiting()` di
  `install`, **JANGAN** auto-reload — pernah infinite-reload-loop (`DECISIONS.md`). Flow: banner
  "Versi baru siap" (`#update-bar`) → tap → `postMessage({type:"SKIP_WAITING"})` → reload di
  `controllerchange` dikunci flag `userAccepted`. Banner ga muncul kalau `controller` null
  (install pertama). "Hard Refresh" (Setting, `hardRefresh()`) = palu darurat.
- **Chart Tren Net Worth**: SELALU dua garis (+CAPEX / tanpa CAPEX) dari `snapshotNetWorth()`
  (total* mentah, bukan `s.netWorth`), claim ngikut toggle sekarang. **Proyeksi**
  (`renderProjectionChart()`): satu garis Aktual (toggle sekarang) + `projectSeries()` (calc.js,
  `annualRate:0` = linear) ×3 (nabung, rate A, rate B), horizon `targetDate` (min 1 bulan) atau
  60 bulan, kontribusi `recentAvgSurplus()` (fallback 0). Null di luar rentang dataset. Garis
  Target di-skip kalau `hidden`. Ga pakai `chartjs-plugin-annotation`. Orkestrasi di view,
  primitif di calc.js. Ga ada garis historis "nabung doang" (`DECISIONS.md` CAPEX).
- **Export Laporan .md** (`buildMonthlyReport()`): cashflow/budget/kategori selalu historis per
  bulan; posisi (section 1/5/6/7/8) lewat `buildPosition()` — bulan berjalan live; bulan lampau
  ber-snapshot lengkap (`isSnapshotComplete()`) dari breakdown ("Posisi akhir {bulan}"); lampau
  tanpa snapshot → posisi terkini + disclaimer (jangan ngarang). Section 1 & 10: DUA angka
  (+CAPEX / tanpa CAPEX) + baris mana yang dipakai app; "Perubahan komposisi" dari
  `netWorthComposition()` dengan pasangan bulan SAMA kayak Δ section 1, skip kalau prevSnap tanpa
  totals. Section 5 CC = Terpakai/Limit/Sisa; section 7 subsection "🪪 Kartu Kredit"; section 8
  header "Terkumpul (tunai+aset)" + kolom Breakdown + catatan likuiditas; section 6 bond & claim
  kolom di-repurpose + baris info; section 9 recurring SELALU live; section 11 konteks murni dari
  state — TIDAK ada profil owner di source JS (static site, semua JS publik).
- **Cek Integritas** (`scanIntegrity()`, read-only, JANGAN auto-fix): referensi yatim (skip
  `assetDeleted`), transfer asal=tujuan, nominal ≤ 0, tanggal > 1 th ke depan, `month` ≠ `date`,
  budget orphan, assetQty/Price/Dir invalid (cabang khusus redeem & qtyless), qty vs jejak
  transaksi (cuma asset ber-transaksi, toleransi 1e-4, wording informatif), bond (maturity lewat,
  principal ≤ 0, rate di luar 0–1, maturity < purchase), qtyless `quantity !== 1`, claim
  (dueDate lewat, qtyless bukan true, sisa > total), CC over-limit / saldo plus, goal link ke
  asset hilang. "Buka" → `openTxDetail()` / `openAssetSheet()` / `openAcctSheet()` /
  `openGoalSheet()` / `#/budget` (sheet-sheet itu di-export khusus buat ini).
- **Zona Bahaya** (`#/danger`, `bulkDelete()`): mode bulan/tahun/total; C1 wipe histori
  (transactions/budgets/snapshots/attachments), C2 reset total (+ master, reseed, `apiKeys` bisa
  dipertahankan). Safeguard: preview jumlah, warning backup > 24 jam, checkbox, type-to-confirm,
  wajib online (dicek di view DAN di db.js). Habis bulk delete saldo berubah → arahkan Reconcile.
- Chart.js dari jsdelivr; offline & belum ke-cache → pesan fallback. iOS bisa evict storage PWA
  (data master di cloud). `attachThousands()`/`parseAmount()` pasangan format ribuan.

## Roadmap

SATU sumber: `TASKS.md` (section Roadmap). Jangan duplikasi daftar di sini.

## Konteks Owner

Ada di `CLAUDE.local.md` (di-gitignore, auto-load Claude Code). Repo ini PUBLIC dan GitHub
Pages nge-serve semua file root — data personal (gaji, nama bank, portfolio, hutang) DILARANG di
file ini, `DECISIONS.md`, `TASKS.md`, `README.md`, dan source JS. Angka finansial riil di narasi
insiden dibikin generik (X/Y).
