// Integrasi harga otomatis — semua provider dipilih karena CORS-friendly
// (bisa dipanggil langsung dari browser, cocok untuk static site):
//
//   stock_id  → FCS API (api-v4.fcsapi.com) — butuh API key (gratis: fcsapi.com/pricing,
//               500 credit/bulan, 3 request/menit, cache ~60 menit — cukup buat auto-refresh
//               1x/20 jam yang app ini pakai). Provider IDX sebelumnya (iTick) udah ga bisa
//               dipakai gratis lagi per pertengahan 2026, makanya diganti.
//   stock_us  → Finnhub (finnhub.io)     — butuh API key (gratis: finnhub.io, 60 call/min)
//   crypto    → CoinGecko                — TANPA API key
//
// Asset dengan manualOnly=true di-skip. Tipe lain (deposito, emas, dll) selalu manual.
import { state } from "./store.js";
import { patch } from "./db.js";
import { todayStr } from "./utils.js";

// symbol crypto umum → CoinGecko id (selain ini, symbol dianggap id CoinGecko langsung)
const COINGECKO_IDS = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  XRP: "ripple", DOGE: "dogecoin", ADA: "cardano", USDT: "tether",
  USDC: "usd-coin", DOT: "polkadot", MATIC: "matic-network", LINK: "chainlink",
};

const keys = () => state.settings.apiKeys || {};

// ---------- Adapters (masing-masing return Map<SYMBOL, price>) ----------

// FCS API: prefix "IDX:" di symbol biar match persis bursa Indonesia (bukan best-guess
// lintas bursa kalau prefix di-skip, lihat dokumentasi fcsapi.com/document/stock-api).
// Multi-symbol didukung satu call (comma-separated), TANPA batasan jumlah simbol per call
// yang didokumentasikan (beda dari iTick dulu) — jadi ga perlu di-chunk.
async function fetchIDX(symbols) {
  const key = keys().fcsapi;
  if (!key) return { prices: new Map(), error: "fcsapi_no_key" };
  const prices = new Map();
  let error = null;
  try {
    const codes = symbols.map((s) => `IDX:${s}`).join(",");
    const url = `https://api-v4.fcsapi.com/stock/latest?symbol=${encodeURIComponent(codes)}&access_key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FCS API HTTP ${res.status}`);
    const j = await res.json();
    if (!j?.status || !Array.isArray(j?.response)) throw new Error(j?.msg || "FCS API: no data");
    for (const r of j.response) {
      const sym = String(r?.ticker || r?.symbol || "").split(":").pop().toUpperCase();
      const price = Number(r?.active?.c ?? r?.c ?? r?.close ?? r?.last ?? r?.price);
      if (sym && price > 0) prices.set(sym, price);
    }
  } catch (e) {
    console.warn("[prices:idx]", e);
    error = String(e.message || e);
  }
  return { prices, error };
}

async function fetchUS(symbols) {
  const key = keys().finnhub;
  if (!key) return { prices: new Map(), error: "finnhub_no_key" };
  const prices = new Map();
  let error = null;
  // Finnhub quote = per-symbol; free tier 60 call/min → aman untuk portfolio personal
  await Promise.all(symbols.map(async (sym) => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
      const j = await res.json();
      const price = Number(j?.c); // c = current price
      if (price > 0) prices.set(sym, price);
    } catch (e) {
      console.warn(`[prices:us:${sym}]`, e);
      error = String(e.message || e);
    }
  }));
  return { prices, error };
}

async function fetchCrypto(assets) {
  // CoinGecko: no key. Harga diambil dalam currency masing-masing asset (IDR/USD).
  const prices = new Map(); // key: SYMBOL|CURRENCY
  try {
    const ids = [...new Set(assets.map((a) => cgId(a.symbol)))];
    const vs = [...new Set(assets.map((a) => (a.currency || "IDR").toLowerCase()))];
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=${vs.join(",")}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const j = await res.json();
    for (const a of assets) {
      const price = Number(j?.[cgId(a.symbol)]?.[(a.currency || "IDR").toLowerCase()]);
      if (price > 0) prices.set(`${a.symbol.toUpperCase()}|${a.currency}`, price);
    }
    return { prices };
  } catch (e) {
    console.warn("[prices:crypto]", e);
    return { prices, error: String(e.message || e) };
  }
}

const cgId = (symbol) => COINGECKO_IDS[(symbol || "").toUpperCase()] || (symbol || "").toLowerCase();

// ---------- Orkestrasi ----------

export const AUTO_TYPES = ["stock_id", "stock_us", "crypto"];

export function refreshableAssets() {
  return state.assets.filter((a) => AUTO_TYPES.includes(a.type) && a.manualOnly !== true && (a.symbol || "").trim());
}

// return { updated, failed: [symbol...], noKey: [provider...] }
export async function refreshPrices() {
  const targets = refreshableAssets();
  const out = { updated: 0, failed: [], noKey: [] };
  if (targets.length === 0) return out;

  const idx = targets.filter((a) => a.type === "stock_id");
  const us = targets.filter((a) => a.type === "stock_us");
  const crypto = targets.filter((a) => a.type === "crypto");

  const [rIdx, rUs, rCrypto] = await Promise.all([
    idx.length ? fetchIDX([...new Set(idx.map((a) => a.symbol.toUpperCase()))]) : { prices: new Map() },
    us.length ? fetchUS([...new Set(us.map((a) => a.symbol.toUpperCase()))]) : { prices: new Map() },
    crypto.length ? fetchCrypto(crypto) : { prices: new Map() },
  ]);

  if (rIdx.error === "fcsapi_no_key") out.noKey.push("FCS API (saham IDX)");
  if (rUs.error === "finnhub_no_key") out.noKey.push("Finnhub (saham US)");

  const updates = [];
  for (const a of targets) {
    const sym = a.symbol.toUpperCase();
    let price = null;
    if (a.type === "stock_id") price = rIdx.prices.get(sym);
    else if (a.type === "stock_us") price = rUs.prices.get(sym);
    else if (a.type === "crypto") price = rCrypto.prices.get(`${sym}|${a.currency}`);

    if (price > 0) {
      updates.push(patch("assets", a.id, {
        manualPrice: price,
        manualPriceUpdatedAt: todayStr(),
        priceSource: a.type === "stock_id" ? "fcsapi" : a.type === "stock_us" ? "finnhub" : "coingecko",
      }));
      out.updated++;
    } else {
      const providerMissingKey =
        (a.type === "stock_id" && rIdx.error === "fcsapi_no_key") ||
        (a.type === "stock_us" && rUs.error === "finnhub_no_key");
      if (!providerMissingKey) out.failed.push(sym);
    }
  }
  await Promise.all(updates);
  return out;
}

// Auto refresh maksimal 1x / 20 jam saat app dibuka (hemat quota)
const AUTO_KEY = "fintrack_last_price_refresh";
export async function autoRefreshIfDue() {
  if (!navigator.onLine) return;
  if (refreshableAssets().length === 0) return;
  const last = Number(localStorage.getItem(AUTO_KEY) || 0);
  if (Date.now() - last < 20 * 3600 * 1000) return;
  localStorage.setItem(AUTO_KEY, String(Date.now()));
  const r = await refreshPrices();
  if (r.updated > 0) console.log(`[prices] auto refresh: ${r.updated} asset updated`);
}
