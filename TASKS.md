# TASKS.md — Backlog Instruksi untuk Claude Code

Cara pakai: buka session (`claude` di root repo), lalu bilang "kerjain TASK-4 di TASKS.md".
Kerjakan **satu task per session/branch**. Baca CLAUDE.md dulu — semua ATURAN WAJIB di sana
berlaku untuk setiap task di sini, terutama:

- Naikin `CACHE_VERSION` di `sw.js` setiap ada perubahan file; file baru masuk array `PRECACHE`.
- Semua akses Firestore lewat `js/db.js`. View re-render via `store.on()`, jangan manual DOM.
- `escapeHtml()` untuk semua user input yang masuk innerHTML.
- Setelah task selesai: update CLAUDE.md (section terkait + hapus task ini dari TASKS.md),
  lalu kasih ringkasan perubahan + file yang disentuh.

Yang SENGAJA di-exclude dari backlog (jangan dikerjain): banner notifikasi update SW —
single user, tombol Hard Refresh di Setting udah cukup.

---

## TASK-4 (P1) — Recurring transactions + ritual awal bulan

**Scope:** template transaksi berulang + prompt awal bulan yang sekaligus menawarkan salin budget.

**Implementasi:**
- Collection baru `recurring`: {name, type (expense|income|transfer), amount, accountId,
  toAccountId?, categoryId, dayOfMonth (1–31), active:true, lastPostedMonth ("YYYY-MM")}.
  CRUD di subpage baru `#/recurring` (menu di Setting, pola sama accounts/categories:
  route + back di ROUTES app.js, file view baru → tambah ke PRECACHE sw.js).
- Saat app dibuka (hook `state.ready` di app.js, pola upsertSnapshot): kumpulkan recurring
  aktif yang `dayOfMonth` ≤ hari ini dan `lastPostedMonth` ≠ bulan ini → tampilkan sheet
  "Awal bulan 📅" berisi checklist item (default tercentang) + 1 baris opsi "Salin budget
  bulan lalu" kalau budget bulan ini masih kosong. Tombol "Catat semua" → buat transaksi
  per item tercentang (date = tanggal hari itu atau tgl dayOfMonth bulan ini, pilih yang
  konsisten dan dokumentasikan), set `lastPostedMonth`, jalankan copy budget kalau dicentang.
  Tombol "Nanti" → tutup, munculkan lagi di pembukaan app berikutnya (jangan spam: maks 1x per hari,
  simpan flag di localStorage).
- JANGAN auto-post tanpa konfirmasi user.
- Tambahkan `recurring` ke `COLLECTIONS` backup di db.js.

**Acceptance:**
- Template kost tgl 1: buka app tgl 3 → sheet muncul, konfirmasi → transaksi tercatat sekali,
  buka app lagi → tidak muncul lagi bulan itu.
- Budget kosong + centang salin → budget bulan lalu tersalin (pakai logic copy yang sudah ada
  di budget.js, jangan duplikasi).
- Semua jalan offline (posting ke-queue oleh Firestore persistence).

---

## TASK-5 (P2, tunggu keputusan owner — JANGAN dikerjakan tanpa konfirmasi) —
## Konsolidasi dua sistem target

Ada 2 sistem paralel: `settings.targetNetWorth` (banner Wealth, pasif, benchmark net worth)
vs `goals` (multi, topup-based). Opsi yang dipertimbangkan:
(a) pertahankan keduanya dengan copy UI yang mempertegas beda peran
    ("North Star" vs "Goals aktif"), atau
(b) matikan targetNetWorth, banner Wealth menampilkan agregat goals.
Kalau task ini disebut owner, TANYA dulu pilihannya sebelum coding.

---

## TASK-6 (P2, kecil) — Snapshot backfill manual

Di Setting (atau subpage baru), form kecil "Tambah snapshot historis": input bulan (YYYY-MM,
hanya bulan < bulan berjalan) + net worth → `put("snapshots", month, {...})`. Boleh field
breakdown kosong. Tujuan: grafik tren Wealth bisa diisi data historis pra-app
(owner punya catatan manual April–Juni 2026). Jangan izinkan menimpa bulan berjalan
(itu wilayah `upsertSnapshot`).

**Acceptance:** tambah snapshot 2026-04 → muncul di chart Tren Net Worth di urutan benar.

---

## TASK-7 (P2, catatan arsitektur — belum eksekusi)

`store.js` listen SEMUA transaksi selamanya. Aman sampai ±3–5rb docs; setelah itu initial load
di HP mulai berat. Kandidat solusi saat dibutuhkan: arsip transaksi > 2 tahun ke collection
`transactions_archive` + export file. Jangan dikerjakan sekarang — evaluasi kalau jumlah
transaksi sudah > 3.000 atau load terasa lambat.
