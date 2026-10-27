// GET /api/macro → Selic, IPCA, unemployment and the minimum wage, current value plus monthly history (for cards and correlations).
// GET /api/macro?historico=1 → the longest history (Selic since 1996, IPCA since the Real in 1995,
//        unemployment since 2012), for the charts opened from the top cards.
// Selic: IPEA series BM366_TJOVER366 (daily, % a.a., mirrors the Central Bank's SGS, which
//        does not answer requests from outside Brazil).
// IPCA:  IBGE SIDRA table 1737 — monthly change (v63) and 12-month change (v2265).
// Desemprego: IBGE SIDRA table 6381 (PNAD Contínua) — unemployment rate (v4099), rolling
//        3-month period stamped with its last month.
// Salário mínimo: IPEA series MTE12_SALMIN12 (monthly, in reais since the Real, July 1994);
//        the series already carries the months ahead of a value set for the year.

import { json, bad } from "./_yahoo.js";

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

async function selic(longo) {
  const since = longo ? "1990-01-01" : new Date(Date.now() - 7 * 365 * 864e5).toISOString().slice(0, 10);
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

async function ipca(longo) {
  const rows = await getJson(`https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/63,2265/p/${longo ? "199501-210012" : "last%2084"}`);
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

async function desemprego(longo) {
  const rows = await getJson(`https://apisidra.ibge.gov.br/values/t/6381/n1/all/v/4099/p/${longo ? "all" : "last%2084"}`);
  const mensal = [];
  let periodo = null;
  for (const r of rows.slice(1)) {
    const v = Number(r.V);
    if (!Number.isFinite(v)) continue;
    mensal.push([`${r.D3C.slice(0, 4)}-${r.D3C.slice(4)}`, v]);
    periodo = r.D3N;
  }
  mensal.sort((a, b) => a[0].localeCompare(b[0]));
  return { mes: mensal.at(-1)?.[0] || null, atual: mensal.at(-1)?.[1] ?? null, periodo, mensal };
}

async function salmin() {
  const rows = (await getJson("http://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='MTE12_SALMIN12')")).value;
  const hoje = new Date().toISOString().slice(0, 7), mensal = [];
  for (const r of rows) {
    const m = r.VALDATA.slice(0, 7);
    if (r.VALVALOR != null && m >= "1994-07" && m <= hoje) mensal.push([m, r.VALVALOR]);
  }
  mensal.sort((a, b) => a[0].localeCompare(b[0]));
  if (!mensal.length) throw new Error("sem dados");
  const valor = mensal.at(-1)[1];
  let i = mensal.length - 1; while (i > 0 && mensal[i - 1][1] === valor) i--;
  // Each change of value is a readjustment: [month, new value].
  const reajustes = mensal.filter(([, v], k) => k === 0 || v !== mensal[k - 1][1]);
  return { valor, desde: mensal[i][0], reajustes };
}

export async function GET(request) {
  const longo = new URL(request.url).searchParams.has("historico");
  const [s, i, d, sm] = await Promise.allSettled([selic(longo), ipca(longo), desemprego(longo), salmin()]);
  if ([s, i, d].every(x => x.status === "rejected")) return bad("fontes indisponíveis", 502);
  const val = x => x.status === "fulfilled" ? x.value : { erro: String(x.reason?.message || x.reason) };
  return json({ selic: val(s), ipca: val(i), desemprego: val(d), salmin: val(sm) }, 21600);
}
