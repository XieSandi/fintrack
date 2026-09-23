// Cek sw.js: semua file runtime app (index.html, manifest, css, js/**, icons) ada di PRECACHE.
// Jalankan manual: node tests/precache.test.mjs — BUKAN runtime app, sengaja ga masuk PRECACHE.
// Ga ngecek CACHE_VERSION udah di-bump atau belum (ga bisa tau dari file doang) — itu tetap
// disiplin manual (CLAUDE.md ATURAN WAJIB #1).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const sw = readFileSync(join(root, "sw.js"), "utf-8");
const m = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
if (!m) { console.error("✗ PRECACHE array ga ketemu di sw.js"); process.exit(1); }
const precache = new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const expected = [
  "./index.html", "./manifest.json", "./css/style.css",
  ...walk(join(root, "js")).map((p) => "./" + relative(root, p)),
  ...walk(join(root, "icons")).filter((p) => /\.(png|svg|ico)$/.test(p)).map((p) => "./" + relative(root, p)),
];

let failed = 0;
for (const f of expected) {
  if (!precache.has(f)) { failed++; console.error(`✗ belum ada di PRECACHE: ${f}`); }
}
for (const f of precache) {
  if (f === "./") continue;
  try { statSync(join(root, f)); } catch { failed++; console.error(`✗ ada di PRECACHE tapi file-nya ga ada: ${f}`); }
}
console.log(failed === 0 ? `✓ PRECACHE lengkap (${precache.size} entri)` : `${failed} masalah`);
if (failed > 0) process.exit(1);
