// GET /api/cotacoes?s=PETR4.SA,AAPL,^BVSP&range=1d[&iv=1d][&ohlc=1]
// Returns the latest price plus a price series for each symbol.
// - range picks the period (up to 20y, or max = all history, monthly); iv overrides the candle interval (default per range below).
// - ohlc=1 adds full candles as bars: [[t, open, high, low, close, volume], ...].
// - AGRO-BR is the site's own "Cesta Agro Brasil" index, built from US farm futures (see agro()).

import { yahoo, json, bad, SYMBOL } from "./_yahoo.js";

const INTERVAL = { "1d": "5m", "5d": "30m", "1mo": "1d", "6mo": "1d", "1y": "1wk", "2y": "1d", "5y": "1mo", "10y": "1wk", "20y": "1mo", "max": "1mo" };
const INTERVALS = new Set(["5m", "15m", "30m", "1h", "1d", "1wk", "1mo"]);
const MIN_GAP_DAYS = { "1d": 0.5, "1wk": 6, "1mo": 27 };
const r4 = x => +x.toFixed(4);

async function one(symbol, range, interval, withBars) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?range=${range}&interval=${interval}&includePrePost=false`;
  const data = await yahoo(url);
  const res = data?.chart?.result?.[0];
  if (!res) throw new Error("sem dados");
  const m = res.meta;
  const times = res.timestamp || [];
  const q = res.indicators?.quote?.[0] || {};
  const closes = q.close || [];
  const points = [], bars = [];
  for (let i = 0; i < times.length; i++) {
    if (closes[i] == null) continue;
    points.push([times[i], r4(closes[i])]);
    if (withBars && [q.open?.[i], q.high?.[i], q.low?.[i]].every(x => x != null && x > 0)) {
      bars.push([times[i], r4(q.open[i]), r4(q.high[i]), r4(q.low[i]), r4(closes[i]), q.volume?.[i] || 0]);
    }
  }
  // Daily/weekly/monthly series end with an extra "live" bar stamped with the last trade
  // time, duplicating the current period: drop it so each candle is one period.
  const gap = MIN_GAP_DAYS[interval];
  if (gap && bars.length > 1 && (bars.at(-1)[0] - bars.at(-2)[0]) / 86400 < gap) bars.pop();
  const prev = range === "1d" ? (m.chartPreviousClose ?? m.previousClose) : (points[0]?.[1] ?? m.chartPreviousClose);
  const tp = m.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  return {
    symbol: m.symbol,
    name: m.longName || m.shortName || m.symbol,
    type: m.instrumentType,
    currency: m.currency,
    exchange: m.fullExchangeName,
    price: m.regularMarketPrice,
    prevClose: prev,
    // Yahoo sends 0 for these when the market is closed (weekends): treat as missing.
    dayHigh: m.regularMarketDayHigh || null,
    dayLow: m.regularMarketDayLow || null,
    high52: m.fiftyTwoWeekHigh || null,
    low52: m.fiftyTwoWeekLow || null,
    volume: m.regularMarketVolume || null,
    time: m.regularMarketTime,
    open: m.instrumentType === "CRYPTOCURRENCY" || (tp ? now >= tp.start && now < tp.end : false),
    points,
    ...(withBars ? { bars, interval } : {}),
  };
}

// Cesta Agro Brasil: the futures of the farm products Brazil exports most, weighted roughly by
// their share of Brazil's farm exports (2024–2025), converted to reais with the dollar.
// Index = 100 × Σ weight × (price ÷ base price) × (dollar ÷ base dollar), base = Dec/2019 close.
// Continuous futures roll to the next contract a few times a year, which can cause small jumps.
export const AGRO = "AGRO-BR";
const CESTA = [["ZS=F", 0.45], ["SB=F", 0.15], ["KC=F", 0.13], ["LE=F", 0.12], ["ZC=F", 0.08], ["CT=F", 0.05], ["OJ=F", 0.02]];
const DOLAR = "USDBRL=X", BASE_MES = "2019-12";
let agroBase = null;   // kept while this server instance is warm
async function agroBases() {
  if (agroBase) return agroBase;
  const series = await Promise.all([...CESTA.map(c => c[0]), DOLAR].map(sym => one(sym, "max", "1mo", false)));
  const b = {};
  series.forEach(q => {
    let v = null;
    for (const [t, c] of q.points) if (new Date((t + 43200) * 1000).toISOString().slice(0, 7) <= BASE_MES) v = c;
    if (!v) throw new Error("sem base para " + q.symbol);
    b[q.symbol] = v;
  });
  return agroBase = b;
}
const agroIndex = (b, px) => 100 * (px[DOLAR] / b[DOLAR]) * CESTA.reduce((acc, [sym, w]) => acc + w * px[sym] / b[sym], 0);
const dayBR = t => new Date((t - 3 * 3600) * 1000).toISOString().slice(0, 10);
async function agro(range, interval, withBars) {
  const syms = [...CESTA.map(c => c[0]), DOLAR];
  const [b, qs] = await Promise.all([agroBases(), Promise.all(syms.map(sym => one(sym, range, interval, false)))]);
  // Products trade at different hours, so the series are lined up by period (day, week or month;
  // the exact time for intraday) and each one carries its last value forward.
  const key = t => interval === "1mo" ? dayBR(t).slice(0, 7) : interval === "1wk" ? (() => { const d = new Date(dayBR(t) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); })() : interval === "1d" ? dayBR(t) : String(t);
  const byKey = new Map();
  qs.forEach(q => { for (const [t, c] of q.points) { const k = key(t); const e = byKey.get(k) || { t, v: {} }; e.t = Math.max(e.t, t); e.v[q.symbol] = c; byKey.set(k, e); } });
  const last = range === "1d" ? Object.fromEntries(qs.map(q => [q.symbol, q.prevClose])) : {};
  const points = [];
  for (const k of [...byKey.keys()].sort()) {
    const e = byKey.get(k);
    Object.assign(last, e.v);
    if (syms.every(sym => last[sym] > 0)) points.push([e.t, r4(agroIndex(b, last))]);
  }
  const now = Object.fromEntries(qs.map(q => [q.symbol, q.price])), prev = Object.fromEntries(qs.map(q => [q.symbol, q.prevClose]));
  const vals = points.map(x => x[1]);
  const bars = withBars ? points.map(([t, c], i) => { const o = i ? points[i - 1][1] : c; return [t, o, Math.max(o, c), Math.min(o, c), c, 0]; }) : null;
  return {
    symbol: AGRO, name: "Cesta Agro Brasil", type: "INDEX", currency: "BRL", exchange: "Radar do Mercado (CBOT, ICE, CME)",
    price: r4(agroIndex(b, now)), prevClose: syms.every(sym => prev[sym] > 0) ? r4(agroIndex(b, prev)) : null,
    dayHigh: range === "1d" && vals.length ? Math.max(...vals) : null, dayLow: range === "1d" && vals.length ? Math.min(...vals) : null,
    high52: null, low52: null, volume: null,
    time: Math.max(...qs.map(q => q.time || 0)), open: qs.some(q => q.open && q.symbol !== DOLAR),
    componentes: CESTA.map(([sym, w]) => { const q = qs.find(x => x.symbol === sym); return { symbol: sym, nome: q?.name, peso: w, price: q?.price, prevClose: q?.prevClose, open: q?.open }; }),
    points, ...(withBars ? { bars, interval } : {}),
  };
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const range = INTERVAL[params.get("range")] ? params.get("range") : "1d";
  const interval = INTERVALS.has(params.get("iv")) ? params.get("iv") : INTERVAL[range];
  const withBars = params.get("ohlc") === "1";
  const symbols = [...new Set((params.get("s") || "").split(",").map(s => s.trim()).filter(Boolean))];
  if (!symbols.length) return bad("informe ?s=");
  if (symbols.length > 60) return bad("máximo de 60 ativos por vez");
  if (!symbols.every(s => SYMBOL.test(s))) return bad("código inválido");

  const results = await Promise.allSettled(symbols.map(s => s === AGRO ? agro(range, interval, withBars) : one(s, range, interval, withBars)));
  const out = {};
  results.forEach((r, i) => {
    out[symbols[i]] = r.status === "fulfilled" ? r.value : { symbol: symbols[i], error: String(r.reason?.message || r.reason) };
  });
  return json({ range, interval, at: Math.floor(Date.now() / 1000), quotes: out }, range === "1d" ? 15 : 300);
}
