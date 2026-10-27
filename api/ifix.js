// GET /api/ifix → the official IFIX daily closing values published by B3, since 2011:
// { pontos: [[unix seconds, close], ...] } oldest first.
// Yahoo only has IFIX intraday (its daily/weekly/monthly series is empty), so the charts use this.
// B3 answers one year per request, as a table of day (rows) × month (rateValue1..12).

import { json, bad } from "./_yahoo.js";

const FIRST_YEAR = 2011;

async function year(y) {
  const q = Buffer.from(JSON.stringify({ language: "pt-br", index: "IFIX", year: String(y) })).toString("base64");
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

export async function GET() {
  const now = new Date().getUTCFullYear(), years = [];
  for (let y = FIRST_YEAR; y <= now; y++) years.push(y);
  const got = await Promise.allSettled(years.map(year));
  const pontos = got.flatMap(g => g.status === "fulfilled" ? g.value : []).sort((a, b) => a[0] - b[0]);
  if (!pontos.length) return bad("B3 indisponível", 502);
  return json({ fonte: "B3", pontos }, 21600);
}
