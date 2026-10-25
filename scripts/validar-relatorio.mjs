// Checks relatorios/ultimo.json against the format in relatorios/INSTRUCOES.md.
// Run: node scripts/validar-relatorio.mjs   (exit code 1 if anything is wrong)

import { readFile } from "node:fs/promises";

const dir = new URL("../relatorios/", import.meta.url);
const rep = JSON.parse(await readFile(new URL("ultimo.json", dir), "utf8"));
const ind = JSON.parse(await readFile(new URL("indicadores.json", dir), "utf8"));
const errors = [];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const err = (where, msg) => errors.push(`${where}: ${msg}`);

if (!DATE.test(rep.data)) err("data", "formato AAAA-MM-DD");
if (typeof rep.resumo_mercado !== "string" || rep.resumo_mercado.length < 40) err("resumo_mercado", "faltando ou curto demais");
if ((rep.resumo_mercado || "").length > 700) err("resumo_mercado", "longo demais (máx. ~600 caracteres)");
if (!Array.isArray(rep.empresas)) err("empresas", "não é lista");

const got = new Set((rep.empresas || []).map(e => e.ticker));
for (const e of ind.empresas) if (!got.has(e.ticker)) err(e.ticker, "está em indicadores.json mas não no relatório");

for (const e of rep.empresas || []) {
  const w = e.ticker || "(sem ticker)";
  if (!e.nome) err(w, "sem nome");
  if (typeof e.resumo !== "string" || e.resumo.length < 30) err(w, "resumo faltando ou curto");
  if (!["positivo", "neutro", "negativo"].includes(e.sentimento)) err(w, "sentimento inválido");
  const c = e.consenso;
  if (!c || ![c.compra, c.neutro, c.venda].every(n => Number.isInteger(n) && n >= 0)) err(w, "consenso.compra/neutro/venda devem ser inteiros ≥ 0");
  if (c && c.preco_alvo_medio != null && !(c.preco_alvo_medio > 0)) err(w, "preco_alvo_medio inválido");
  for (const k of c?.casas || []) if (!["compra", "neutro", "venda"].includes(k.recomendacao)) err(w, `casa ${k.nome}: recomendação inválida`);
  for (const m of e.mudancas || []) if (!DATE.test(m.data || "")) err(w, "mudança sem data válida");
  for (const f of e.fontes || []) if (!/^https?:\/\//.test(f.url || "")) err(w, `fonte sem link: ${f.nome}`);
  if (/\b(eu recomendo|recomendamos|vale a pena comprar|vale a pena vender)\b/i.test(e.resumo || "")) err(w, "resumo com recomendação própria");
  if (!DATE.test(e.atualizado_em || "")) err(w, "atualizado_em inválido");
}

if (errors.length) { console.error(errors.join("\n")); console.error(`\n${errors.length} problema(s).`); process.exit(1); }
console.log(`OK: ${rep.empresas.length} empresas, relatório de ${rep.data}.`);
