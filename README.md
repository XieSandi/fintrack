# FinTrack 💰

Personal finance tracker PWA — expense harian, budget bulanan, assets & net worth.
Vanilla JS, zero build, Firebase Firestore (offline-first), hosted di GitHub Pages.

**Live:** https://xiesandi.cyou/fintrack

## Fitur

- 📒 Catat expense/income/transfer per akun (bank, e-wallet, cash, RDN, broker, kartu kredit),
  lengkap dengan tanggal + jam, opsi 🧾 biaya tambahan (admin transfer, parkir, dll), dan
  transfer lintas mata uang IDR↔USD dengan kurs + nominal diterima yang bisa diisi manual
- ⚖️ Sesuaikan saldo (reconcile) jadi transaksi penyesuaian, boleh minus; kartu kredit input-nya
  "tagihan terpakai"
- 🔢 Simpan no. rekening / no. kartu per akun + tombol copy (sengaja TIDAK ikut ke laporan .md)
- 📊 Budget bulanan per kategori + progress bar + salin dari bulan lalu
- 💰 Assets (saham IDX per lot, US fractional shares, reksa dana, deposito, emas, crypto,
  obligasi/SBN ritel, CAPEX/barang susut) dengan harga manual/auto + P&L, plus Catat
  Pembelian/Penjualan (weighted avg buy price)
- 🏦 Obligasi/SBN ritel: nilai par (bukan fluktuatif ala saham), hitung mundur jatuh tempo, catat
  kupon masuk & cairkan pokok — kupon sengaja TIDAK auto-post (pajak & timing mutasi beda-beda)
- 🔢 Mode "Jumlah N/A" buat posisi lump-sum (deposito, emas, investasi bisnis) — pembelian nambah
  nilai, bukan jumlah unit
- 🎯 Short Term Goals (bisa banyak, topup/pencairan aktif) — bisa juga di-link ke asset yang
  sudah ada, terpisah dari 🏆 Main Milestone (satu target net worth jangka panjang)
- 📈 Net worth otomatis (cash + assets + goal savings − debt), snapshot bulanan, grafik tren &
  dashboard proyeksi ke target
- 💳 Kartu kredit sebagai akun biasa (utang derived dari saldo negatif) + Debt tracker terpisah
  buat cicilan tetap: hutang baru bisa sekalian catat dana pinjaman masuk ke akun, detail per
  hutang (progress + riwayat), Bayar Cicilan dengan foto/link bukti, arsip (ga pernah dihapus)
- 🤝 Claim (piutang): catat uang yang dipinjemin ke orang — potong akun sumber, siapa & kapan
  bisa ditagih, pembayaran dicicil (tiap cicilan satu transaksi) dengan foto/link bukti, tab
  sendiri di Wealth + toggle ikut/enggak di net worth, arsip (ga pernah dihapus)
- 🗑️ Asset yang posisinya udah 0 bisa dihapus walau punya riwayat beli/jual — transaksinya tetap
  ada di History (ditandai "asset dihapus")
- 🔁 Recurring/rutin bulanan (termasuk DCA beli asset) dengan konfirmasi "Awal Bulan"
- 👁️ Blur mode — mask semua angka finansial jadi asterisk **panjang tetap**, jadi ordo angkanya
  ga ketebak dari jumlah bintang atau lebar teksnya (buat dipakai di tempat umum)
- 💵 Kurs USD/IDR auto (frankfurter.app) dengan override manual
- ⚡ Auto price asset: saham IDX (TradingView, tanpa key), saham/ETF US (Finnhub), crypto (CoinGecko, tanpa key) — tombol 🔄 di tab Assets + auto-refresh 1x/hari saat app dibuka; per-asset bisa dikunci manual
- ⚡ Offline-first: catat transaksi tanpa internet, auto-sync saat online (Firestore persistence)
- 📄 Export laporan .md siap paste ke AI, plus backup/restore JSON (Replace All / Merge)
- 🩺 Cek Integritas Data (scan referensi yatim, read-only) + Reset Data (Zona Bahaya)
- 📱 PWA installable + banner "Versi baru siap" (update service worker cukup satu tap)
- 🖥️ Tema calm dark, mobile-first tapi adaptif di browser desktop (kolom melebar, nav jadi pill
  mengambang, bottom sheet jadi modal tengah)

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
├─ db.js              repository: CRUD + hook efek debt/asset, seeding, snapshot, backup, bulk delete,
│                      foto bukti (collection attachments)
├─ integrity.js       scan referensi yatim (read-only)
├─ kurs.js            kurs USD/IDR auto
├─ prices.js          auto price: TradingView (IDX), Finnhub (US), CoinGecko (crypto)
├─ tx-sheet.js        sheet tambah/edit transaksi (quick-add)
├─ recurring-sheet.js sheet konfirmasi "Awal Bulan" (post recurring)
├─ report-md.js       generate laporan finansial .md
├─ utils.js           format, tanggal, toast, sheet, blur mode, copy clipboard, hard refresh
└─ views/             home, transactions, budget, wealth, settings, accounts, categories,
                       goals, recurring, danger
icons/
tests/
├─ calc.test.mjs      smoke test manual buat js/calc.js (`node tests/calc.test.mjs`)
└─ precache.test.mjs  cek PRECACHE sw.js lengkap (`node tests/precache.test.mjs`)
```

Repo ini public dan GitHub Pages nge-serve semua file root, jadi jangan taruh data personal di
file manapun yang di-commit — konteks owner ada di `CLAUDE.local.md` (di-gitignore).

Dokumentasi lebih lengkap buat development (aturan wajib, arsitektur detail, data model,
known quirks) ada di `CLAUDE.md`; narasi historis "kenapa" di balik keputusan desain & insiden
ada di `DECISIONS.md`; backlog task ada di `TASKS.md`.

## Deploy (GitHub Pages)

1. Push ke branch **`main`**. GitHub → Settings → Pages → Source: **Deploy from a branch** →
   branch `main`, folder `/ (root)`. **Bukan** GitHub Actions, bukan branch `gh-pages` — cuma
   satu jalur ini yang dipakai, push ke `main` = deploy.
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

Rule wildcard di atas udah nge-cover semua collection termasuk `attachments` (foto bukti
Claim/Hutang, disimpan sebagai JPEG terkompres di Firestore — bukan Firebase Storage, jadi
ga perlu setup Storage).

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

Setiap ada perubahan file, naikkan `CACHE_VERSION` di `sw.js` (misal `fintrack-v2`). File baru
juga wajib masuk array `PRECACHE` — cek dengan `node tests/precache.test.mjs`.

Di sisi user, SW baru **ga langsung ambil alih** — itu sengaja (auto-activate + auto-reload pernah
bikin infinite-reload-loop, lihat `DECISIONS.md`). Yang muncul: banner **"Versi baru siap"** →
user tap **Muat ulang** → SW baru aktif + halaman reload. Kalau SW-nya sendiri yang nyangkut,
palu daruratnya tombol **Hard Refresh** di Setting.
