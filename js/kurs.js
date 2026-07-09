// Kurs USD → IDR otomatis via frankfurter.app (gratis, no key, CORS-friendly).
// Cache di localStorage; offline → pakai cache terakhir; bisa override manual di Settings.
import { setKurs } from "./store.js";

const CACHE_KEY = "fintrack_usdidr";

export function loadCachedKurs() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (c?.rate) { setKurs(c); return c; }
  } catch {}
  return null;
}

export async function refreshKurs() {
  if (!navigator.onLine) return loadCachedKurs();
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=IDR", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const j = await res.json();
    const k = { rate: j.rates.IDR, date: j.date, source: "frankfurter" };
    localStorage.setItem(CACHE_KEY, JSON.stringify(k));
    setKurs(k);
    return k;
  } catch (e) {
    console.warn("[kurs] fetch gagal, pakai cache:", e);
    return loadCachedKurs();
  }
}
