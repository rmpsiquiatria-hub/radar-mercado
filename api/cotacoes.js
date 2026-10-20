// GET /api/cotacoes?s=PETR4.SA,AAPL,^BVSP&range=1d
// Returns the latest price plus a price series for each symbol.

import { yahoo, json, bad, SYMBOL } from "./_yahoo.js";

const INTERVAL = { "1d": "5m", "5d": "30m", "1mo": "1d", "6mo": "1d", "1y": "1wk", "5y": "1mo" };

async function one(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?range=${range}&interval=${INTERVAL[range]}&includePrePost=false`;
  const data = await yahoo(url);
  const res = data?.chart?.result?.[0];
  if (!res) throw new Error("sem dados");
  const m = res.meta;
  const times = res.timestamp || [];
  const closes = res.indicators?.quote?.[0]?.close || [];
  const points = [];
  for (let i = 0; i < times.length; i++) {
    if (closes[i] != null) points.push([times[i], +closes[i].toFixed(4)]);
  }
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
    dayHigh: m.regularMarketDayHigh,
    dayLow: m.regularMarketDayLow,
    high52: m.fiftyTwoWeekHigh,
    low52: m.fiftyTwoWeekLow,
    volume: m.regularMarketVolume,
    time: m.regularMarketTime,
    open: m.instrumentType === "CRYPTOCURRENCY" || (tp ? now >= tp.start && now < tp.end : false),
    points,
  };
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const range = INTERVAL[params.get("range")] ? params.get("range") : "1d";
  const symbols = [...new Set((params.get("s") || "").split(",").map(s => s.trim()).filter(Boolean))];
  if (!symbols.length) return bad("informe ?s=");
  if (symbols.length > 60) return bad("máximo de 60 ativos por vez");
  if (!symbols.every(s => SYMBOL.test(s))) return bad("código inválido");

  const results = await Promise.allSettled(symbols.map(s => one(s, range)));
  const out = {};
  results.forEach((r, i) => {
    out[symbols[i]] = r.status === "fulfilled" ? r.value : { symbol: symbols[i], error: String(r.reason?.message || r.reason) };
  });
  return json({ range, at: Math.floor(Date.now() / 1000), quotes: out }, range === "1d" ? 15 : 300);
}
