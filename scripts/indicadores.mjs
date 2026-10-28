// Builds relatorios/indicadores.json: the list of companies the daily report covers
// (today's Ibovespa + relatorios/acompanhar.json) with their fundamentals from Fundamentus.
// Run: node scripts/indicadores.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const OUT_DIR = new URL("../relatorios/", import.meta.url);

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r;
}

async function ibovespa() {
  const q = Buffer.from(JSON.stringify({ language: "pt-br", pageNumber: 1, pageSize: 200, index: "IBOV", segment: "1" })).toString("base64");
  const data = await (await get(`https://sistemaswebb3-listados.b3.com.br/indexProxy/indexCall/GetPortfolioDay/${q}`)).json();
  return data.results.map(r => ({ ticker: r.cod.trim(), nome: r.asset.trim(), peso_ibov: num(r.part) }));
}

// "1.234,56" → 1234.56, "6,21%" → 6.21, "-" or "" → null
function num(s) {
  const t = String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s/g, "").replace(/%$/, "");
  if (!t || t === "-") return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const COLS = ["cotacao", "pl", "pvp", "psr", "dy", "p_ativo", "p_cap_giro", "p_ebit", "p_ativ_circ_liq",
  "ev_ebit", "ev_ebitda", "margem_bruta", "margem_ebit", "margem_liq", "liq_corrente", "roic", "roe", "liq_2meses",
  "patrimonio_liq", "div_liq_pl", "cresc_rec_5a"];

async function fundamentus() {
  const buf = await (await get("https://www.fundamentus.com.br/resultado.php")).arrayBuffer();
  const html = new TextDecoder("latin1").decode(buf);
  const out = {};
  for (const row of html.split(/<tr[^>]*>/).slice(1)) {
    const m = row.match(/detalhes\.php\?papel=([A-Z0-9]+)/);
    if (!m) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]).slice(1);
    if (cells.length < COLS.length) continue;
    const name = row.match(/title="([^"]*)"/)?.[1];
    const o = { nome_curto: name };
    COLS.forEach((k, i) => { o[k] = num(cells[i]); });
    out[m[1]] = o;
  }
  return out;
}

async function extras() {
  try {
    const d = JSON.parse(await readFile(new URL("acompanhar.json", OUT_DIR), "utf8"));
    return (d.tickers || []).map(t => String(t).toUpperCase().replace(/\.SA$/, ""));
  } catch { return []; }
}

const [ibov, fund, extra] = await Promise.all([ibovespa(), fundamentus(), extras()]);
const byTicker = new Map(ibov.map(c => [c.ticker, { ...c, origem: ["ibovespa"] }]));
for (const t of extra) {
  if (byTicker.has(t)) byTicker.get(t).origem.push("lista pessoal");
  else byTicker.set(t, { ticker: t, nome: fund[t]?.nome_curto || t, peso_ibov: null, origem: ["lista pessoal"] });
}
const empresas = [...byTicker.values()].map(c => {
  const f = fund[c.ticker];
  const bolsa = f || /^[A-Z]{4}\d{1,2}$/.test(c.ticker) ? "B3" : "EUA";
  const { nome_curto, ...ind } = f || {};
  return { ...c, bolsa, indicadores: f ? ind : null };
}).sort((a, b) => (b.peso_ibov ?? -1) - (a.peso_ibov ?? -1));

await mkdir(OUT_DIR, { recursive: true });
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
if (!empresas.length) { console.error("nenhuma empresa baixada; indicadores.json mantido"); process.exit(1); }
await writeFile(new URL("indicadores.json", OUT_DIR), JSON.stringify({ data: today, fonte: "B3 (composição do Ibovespa) e Fundamentus (indicadores)", empresas }, null, 1));
const missing = empresas.filter(e => e.bolsa === "B3" && !e.indicadores).map(e => e.ticker);
console.log(`${empresas.length} empresas (${ibov.length} do Ibovespa). Sem indicadores: ${missing.join(", ") || "nenhuma"}`);
