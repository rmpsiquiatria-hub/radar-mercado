// Joins the research batches with the indicators into relatorios/ultimo.json
// (and relatorios/historico/AAAA-MM-DD.json).
// Run: node scripts/montar-relatorio.mjs <pasta-dos-lotes>
//   <pasta>/lote-*.json  → lists of researched companies (format in INSTRUCOES.md, without indicadores)
//   <pasta>/mercado.json → {"resumo_mercado": "..."}
// A company missing from the batches keeps its research from the previous ultimo.json.
// relatorios/tecnica.json (scripts/tecnica.mjs), when present, is attached as "tecnica".
// Pass "-" as the folder to only refresh indicators/technicals on top of the previous research.

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";

const dir = process.argv[2] === "-" ? null : process.argv[2];
if (!process.argv[2]) { console.error("uso: node scripts/montar-relatorio.mjs <pasta-dos-lotes>"); process.exit(1); }
const rel = new URL("../relatorios/", import.meta.url);
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

const ind = await readJson(new URL("indicadores.json", rel));
const prev = await readJson(new URL("ultimo.json", rel)).catch(() => ({ empresas: [] }));
const prevBy = new Map(prev.empresas.map(e => [e.ticker, e]));
const tec = await readJson(new URL("tecnica.json", rel)).catch(() => null);

const found = new Map();
for (const f of (dir ? await readdir(dir) : []).filter(f => /^lote-.*\.json$/.test(f)).sort()) {
  for (const e of await readJson(join(dir, f))) found.set(String(e.ticker).toUpperCase(), e);
}
const mercado = dir ? await readJson(join(dir, "mercado.json")).catch(() => ({})) : {};

const empresas = ind.empresas.map(base => {
  const r = found.get(base.ticker) || prevBy.get(base.ticker);
  if (!r) console.warn(`sem pesquisa: ${base.ticker}`);
  return {
    ticker: base.ticker,
    nome: r?.nome || base.nome,
    bolsa: base.bolsa,
    origem: base.origem,
    peso_ibov: base.peso_ibov,
    indicadores: base.indicadores,
    tecnica: tec?.ativos?.[base.ticker] || null,
    resumo: r?.resumo || "Sem notícias ou análises encontradas nas fontes consultadas.",
    sentimento: r?.sentimento || "neutro",
    consenso: r?.consenso || { compra: 0, neutro: 0, venda: 0, preco_alvo_medio: null, moeda: base.bolsa === "B3" ? "BRL" : "USD", casas: [] },
    mudancas: r?.mudancas || [],
    fontes: r?.fontes || [],
    atualizado_em: r?.atualizado_em || ind.data,
  };
});

// With research, the report is dated today in Brasília, even if the indicators are older (the GitHub
// job that refreshes them at 5h30 is sometimes hours late); otherwise the research looked a day old and
// the e-mail waited for a research that had already run.
const now = new Date(), hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
const data = dir && hoje > ind.data ? hoje : ind.data;
const out = {
  data,
  gerado_em: now.toISOString(),
  // Day the news research last ran (differs from `data` when only prices/technicals were refreshed).
  pesquisa_data: dir ? data : (prev.pesquisa_data || prev.data || ind.data),
  indicadores_data: ind.data,
  resumo_mercado: mercado.resumo_mercado || prev.resumo_mercado || "",
  fontes_mercado: mercado.fontes || prev.fontes_mercado || [],
  tecnica_data: tec?.data || null,
  empresas,
};
await mkdir(new URL("historico/", rel), { recursive: true });
const text = JSON.stringify(out, null, 1);
await writeFile(new URL("ultimo.json", rel), text);
await writeFile(new URL(`historico/${data}.json`, rel), text);
console.log(`Relatório ${data}${data !== ind.data ? ` (indicadores de ${ind.data})` : ""}: ${empresas.length} empresas (${found.size} pesquisadas agora).`);
