// GET /api/cotacoes?s=PETR4.SA,AAPL,^BVSP&range=1d[&iv=1d][&ohlc=1]
// Returns the latest price plus a price series for each symbol.
// - range picks the period; iv overrides the candle interval (default per range below).
// - ohlc=1 adds full candles as bars: [[t, open, high, low, close, volume], ...].

import { yahoo, json, bad, SYMBOL } from "./_yahoo.js";

const INTERVAL = { "1d": "5m", "5d": "30m", "1mo": "1d", "6mo": "1d", "1y": "1wk", "2y": "1d", "5y": "1mo", "10y": "1wk", "20y": "1mo" };
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

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const range = INTERVAL[params.get("range")] ? params.get("range") : "1d";
  const interval = INTERVALS.has(params.get("iv")) ? params.get("iv") : INTERVAL[range];
  const withBars = params.get("ohlc") === "1";
  const symbols = [...new Set((params.get("s") || "").split(",").map(s => s.trim()).filter(Boolean))];
  if (!symbols.length) return bad("informe ?s=");
  if (symbols.length > 60) return bad("máximo de 60 ativos por vez");
  if (!symbols.every(s => SYMBOL.test(s))) return bad("código inválido");

  const results = await Promise.allSettled(symbols.map(s => one(s, range, interval, withBars)));
  const out = {};
  results.forEach((r, i) => {
    out[symbols[i]] = r.status === "fulfilled" ? r.value : { symbol: symbols[i], error: String(r.reason?.message || r.reason) };
  });
  return json({ range, interval, at: Math.floor(Date.now() / 1000), quotes: out }, range === "1d" ? 15 : 300);
}
