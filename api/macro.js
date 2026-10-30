// GET /api/macro → Selic, IPCA, unemployment, the minimum wage, GDP, GDP per capita, real average income, life expectancy and HDI, current value plus monthly history (for cards and correlations).
// GET /api/macro?historico=1 → the longest history (Selic since 1996, IPCA since the Real in 1995,
//        unemployment since 2012), for the charts opened from the top cards.
// Selic: IPEA series BM366_TJOVER366 (daily, % a.a., mirrors the Central Bank's SGS, which
//        does not answer requests from outside Brazil).
// IPCA:  IBGE SIDRA table 1737 — monthly change (v63) and 12-month change (v2265).
// Desemprego: IBGE SIDRA table 6381 (PNAD Contínua) — unemployment rate (v4099), rolling
//        3-month period stamped with its last month.
// Salário mínimo: IPEA series MTE12_SALMIN12 (monthly, in reais since the Real, July 1994);
//        the series already carries the months ahead of a value set for the year.
// PIB: IBGE SIDRA table 5932 (Contas Nacionais Trimestrais) — real growth over 4 quarters (v6562) and
//        quarter on previous quarter, seasonally adjusted (v6564); table 1846 (v585) for the value in
//        reais, summed over the last 4 quarters.
// PIB per capita: World Bank NY.GDP.PCAP.CN (reais, current prices), .CD (US$) and .KD.ZG (real
//        growth), yearly, from IBGE data; IBGE's own table 6784 stops two years further back.
// Renda média real: IBGE SIDRA table 6390 (PNAD Contínua), v5933 — usual monthly income from work,
//        in reais of the latest month, rolling 3-month period stamped with its last month.
// Expectativa de vida: World Bank SP.DYN.LE00.IN (UN estimates, yearly, includes the pandemic dip).
// IDH: IPEA series IDHM, Brazil level (Atlas do Desenvolvimento Humano, PNUD/IPEA/FJP), yearly from
//        2012 on PNAD data (the 1991/2000/2010 census values use another method, so they are left out).

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

const trimestre = c => `${c.slice(0, 4)}-${String(+c.slice(4) * 3).padStart(2, "0")}`;   // 202602 → "2026-06", the quarter's last month
async function pib() {
  const [tx, vl] = await Promise.all([
    getJson("https://apisidra.ibge.gov.br/values/t/5932/n1/all/v/6562,6564/p/all/c11255/90707"),
    getJson("https://apisidra.ibge.gov.br/values/t/1846/n1/all/v/585/p/all/c11255/90707"),
  ]);
  const quatro = [], tri = [], nomes = {};
  for (const r of tx.slice(1)) {
    const v = Number(r.V); if (r.V === "..." || !Number.isFinite(v)) continue;
    const m = trimestre(r.D3C); nomes[m] = r.D3N;
    (r.D2C === "6562" ? quatro : tri).push([m, v]);
  }
  const valores = vl.slice(1).filter(r => Number.isFinite(Number(r.V))).map(r => [trimestre(r.D3C), Number(r.V)]).sort((a, b) => a[0].localeCompare(b[0]));
  quatro.sort((a, b) => a[0].localeCompare(b[0])); tri.sort((a, b) => a[0].localeCompare(b[0]));
  if (!quatro.length) throw new Error("sem dados");
  const ult = valores.slice(-4), mes = quatro.at(-1)[0];
  return {
    mes, periodo: nomes[mes] || null, quatro_tri: quatro.at(-1)[1], trimestre: tri.at(-1)?.[1] ?? null,
    valor_12m: ult.length === 4 && ult.at(-1)[0] === mes ? ult.reduce((a, x) => a + x[1], 0) * 1e6 : null,   // reais
    quatro_tri_serie: quatro,
  };
}

async function pibpc() {
  const wb = id => getJson(`https://api.worldbank.org/v2/country/BRA/indicator/${id}?format=json&per_page=100`)
    .then(rows => new Map((rows[1] || []).filter(r => r.value != null && +r.date >= 1996).map(r => [+r.date, r.value])));
  const [reais, dolares, real] = await Promise.all([wb("NY.GDP.PCAP.CN"), wb("NY.GDP.PCAP.CD"), wb("NY.GDP.PCAP.KD.ZG")]);
  const anos = [...reais.keys()].sort((a, b) => a - b).map(y => [y, Math.round(reais.get(y)), dolares.has(y) ? Math.round(dolares.get(y)) : null, real.has(y) ? Math.round(real.get(y) * 100) / 100 : null]);
  if (!anos.length) throw new Error("sem dados");
  return { fonte: "Banco Mundial (dados do IBGE)", anos };   // [year, R$, US$, real growth %]
}

async function renda() {
  const rows = await getJson("https://apisidra.ibge.gov.br/values/t/6390/n1/all/v/5933/p/all");
  const mensal = [];
  let periodo = null;
  for (const r of rows.slice(1)) {
    const v = Number(r.V); if (!Number.isFinite(v)) continue;
    mensal.push([`${r.D3C.slice(0, 4)}-${r.D3C.slice(4)}`, v]); periodo = r.D3N;
  }
  mensal.sort((a, b) => a[0].localeCompare(b[0]));
  if (!mensal.length) throw new Error("sem dados");
  return { mes: mensal.at(-1)[0], atual: mensal.at(-1)[1], periodo, mensal };
}

async function expvida() {
  const rows = await getJson("https://api.worldbank.org/v2/country/BRA/indicator/SP.DYN.LE00.IN?format=json&per_page=100");
  const anos = (rows[1] || []).filter(r => r.value != null && +r.date >= 1990).map(r => [+r.date, Math.round(r.value * 100) / 100]).sort((a, b) => a[0] - b[0]);
  if (!anos.length) throw new Error("sem dados");
  return { fonte: "Banco Mundial (estimativas da ONU)", anos };
}

async function idh() {
  const rows = (await getJson("http://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='IDHM')")).value;
  const anos = rows.filter(r => r.NIVNOME === "Brasil" && r.VALVALOR != null && +r.VALDATA.slice(0, 4) >= 2012).map(r => [+r.VALDATA.slice(0, 4), r.VALVALOR]).sort((a, b) => a[0] - b[0]);
  if (!anos.length) throw new Error("sem dados");
  return { fonte: "Atlas do Desenvolvimento Humano (PNUD, IPEA, FJP), via IPEA", anos };
}

export async function GET(request) {
  const longo = new URL(request.url).searchParams.has("historico");
  const [s, i, d, sm, ev, ih, pb, pc, rd] = await Promise.allSettled([selic(longo), ipca(longo), desemprego(longo), salmin(), expvida(), idh(), pib(), pibpc(), renda()]);
  if ([s, i, d].every(x => x.status === "rejected")) return bad("fontes indisponíveis", 502);
  const val = x => x.status === "fulfilled" ? x.value : { erro: String(x.reason?.message || x.reason) };
  return json({ selic: val(s), ipca: val(i), desemprego: val(d), salmin: val(sm), expvida: val(ev), idh: val(ih), pib: val(pb), pibpc: val(pc), renda: val(rd) }, 21600);
}
