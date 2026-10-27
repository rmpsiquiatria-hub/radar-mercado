// GET /api/ifix?indice=IFIX|INDX|ICON → the official daily closing values published by B3
// (IFIX since 2011; the industrial and consumer indices since 2006):
// { pontos: [[unix seconds, close], ...] } oldest first.
// Yahoo only has these indices intraday (their daily/weekly/monthly series are empty), so the charts use this.
// B3 answers one year per request, as a table of day (rows) × month (rateValue1..12).

import { json, bad } from "./_yahoo.js";

const FIRST_YEAR = { IFIX: 2011, INDX: 2006, ICON: 2006 };

async function year(index, y) {
  const q = Buffer.from(JSON.stringify({ language: "pt-br", index, year: String(y) })).toString("base64");
  const r = await fetch(`https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay/${q}`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`B3 ${r.status}`);
  const out = [];
  for (const row of (await r.json()).results || []) {
    for (let m = 1; m <= 12; m++) {
      const v = row[`rateValue${m}`];
      if (!v) continue;
      const n = Number(v.replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(n)) out.push([Date.UTC(y, m - 1, row.day, 21) / 1000, n]);   // 18h in Brasília, after the close
    }
  }
  return out;
}

// B3 turns away bursts of requests, so years are fetched three at a time, with retries.
const wait = ms => new Promise(r => setTimeout(r, ms));
async function yearRetry(index, y) {
  for (let i = 0; ; i++) {
    try { const v = await year(index, y); if (v.length || y === new Date().getUTCFullYear()) return v; throw new Error("vazio"); }
    catch (e) { if (i >= 3) throw e; await wait(500 * (i + 1)); }
  }
}

export async function GET(request) {
  const index = new URL(request.url).searchParams.get("indice") || "IFIX";
  if (!FIRST_YEAR[index]) return bad("índice desconhecido", 400);
  const now = new Date().getUTCFullYear(), years = [], byYear = {};
  for (let y = FIRST_YEAR[index]; y <= now; y++) years.push(y);
  const queue = years.slice();
  await Promise.all([0, 1, 2].map(async () => { for (let y; (y = queue.shift()) != null;) { try { byYear[y] = await yearRetry(index, y); } catch {} } }));
  const faltando = years.filter(y => !byYear[y]);
  const pontos = years.flatMap(y => byYear[y] || []).sort((a, b) => a[0] - b[0]);
  if (!pontos.length) return bad("B3 indisponível", 502);
  // An incomplete answer is cached only briefly, so the next visit tries again.
  return json({ fonte: "B3", indice: index, pontos, faltando }, faltando.length ? 120 : 21600);
}
