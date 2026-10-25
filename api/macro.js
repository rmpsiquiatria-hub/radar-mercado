// GET /api/macro → Selic and IPCA, current value plus monthly history (for cards and correlations).
// Selic: IPEA series BM366_TJOVER366 (daily, % a.a., mirrors the Central Bank's SGS, which
//        does not answer requests from outside Brazil).
// IPCA:  IBGE SIDRA table 1737 — monthly change (v63) and 12-month change (v2265).

import { json, bad } from "./_yahoo.js";

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

async function selic() {
  const since = new Date(Date.now() - 7 * 365 * 864e5).toISOString().slice(0, 10);
  const url = "http://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='BM366_TJOVER366')"
    + `?$filter=${encodeURIComponent(`VALDATA ge ${since}T00:00:00-03:00`)}`;
  let rows;
  try { rows = (await getJson(url)).value; }
  catch { rows = (await getJson("http://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='BM366_TJOVER366')")).value; }
  const byMonth = new Map();
  let last = null;
  for (const r of rows) {
    if (r.VALVALOR == null) continue;
    const d = r.VALDATA.slice(0, 10);
    if (d < since) continue;
    byMonth.set(d.slice(0, 7), r.VALVALOR);   // last value of each month
    last = { data: d, valor: r.VALVALOR };
  }
  return { atual: last, mensal: [...byMonth.entries()] };
}

async function ipca() {
  const rows = await getJson("https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/63,2265/p/last%2084");
  const mensal = [], doze = [];
  for (const r of rows.slice(1)) {
    const mes = `${r.D3C.slice(0, 4)}-${r.D3C.slice(4)}`, v = Number(r.V);
    if (!Number.isFinite(v)) continue;
    (r.D2C === "63" ? mensal : doze).push([mes, v]);
  }
  mensal.sort((a, b) => a[0].localeCompare(b[0]));
  doze.sort((a, b) => a[0].localeCompare(b[0]));
  return { mes: mensal.at(-1)?.[0] || null, mensal_atual: mensal.at(-1)?.[1] ?? null, doze_meses_atual: doze.at(-1)?.[1] ?? null, mensal, doze_meses: doze };
}

export async function GET() {
  const [s, i] = await Promise.allSettled([selic(), ipca()]);
  if (s.status === "rejected" && i.status === "rejected") return bad("fontes indisponíveis", 502);
  return json({
    selic: s.status === "fulfilled" ? s.value : { erro: String(s.reason?.message || s.reason) },
    ipca: i.status === "fulfilled" ? i.value : { erro: String(i.reason?.message || i.reason) },
  }, 21600);
}
