// Checks relatorios/leis/ultimo.json (the routine's analysis) against the day's collection and fills
// in title, agency, sphere and link from the ids, so links never come from the model.
// Also writes relatorios/leis/historico/<data>.json. Exits 1 with the problems listed.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const dir = new URL("../relatorios/leis/", import.meta.url);
const col = JSON.parse(await readFile(new URL("coleta.json", dir), "utf8"));
const an = JSON.parse(await readFile(new URL("ultimo.json", dir), "utf8"));
const porId = new Map(col.itens.map(i => [i.id, i]));
const erros = [];
if (an.data !== col.data) erros.push(`data ${an.data} diferente da coleta (${col.data})`);
if (typeof an.resumo_geral !== "string" || an.resumo_geral.length < 20) erros.push("resumo_geral vazio ou curto demais");
if (!Array.isArray(an.destaques)) erros.push("destaques precisa ser uma lista");
const vistos = new Set();
for (const [k, d] of (an.destaques || []).entries()) {
  const it = porId.get(d.id);
  if (!it) { erros.push(`destaque ${k + 1}: id "${d.id}" não existe na coleta`); continue; }
  if (vistos.has(d.id)) erros.push(`destaque ${k + 1}: id "${d.id}" repetido`);
  vistos.add(d.id);
  if (!["alta", "media"].includes(d.relevancia)) erros.push(`${d.id}: relevancia deve ser "alta" ou "media"`);
  if (!d.o_que_muda || d.o_que_muda.length < 15) erros.push(`${d.id}: o_que_muda vazio`);
  Object.assign(d, { esfera: it.esfera, titulo: it.titulo, orgao: it.unidade || it.orgao, tipo: it.tipo, url: it.url, fonte: it.fonte });
  d.temas = Array.isArray(d.temas) ? d.temas : [];
}
if (erros.length) { console.error("Problemas:\n- " + erros.join("\n- ")); process.exit(1); }
const ordem = { alta: 0, media: 1 }, esf = { federal: 0, estadual: 1, municipal: 2 };
an.destaques.sort((a, b) => ordem[a.relevancia] - ordem[b.relevancia] || esf[a.esfera] - esf[b.esfera]);
an.fontes = col.fontes;
an.totais = Object.fromEntries(["federal", "estadual", "municipal"].map(e => [e, col.itens.filter(i => i.esfera === e).length]));
await writeFile(new URL("ultimo.json", dir), JSON.stringify(an, null, 1));
await mkdir(new URL("historico/", dir), { recursive: true });
await writeFile(new URL(`historico/${an.data}.json`, dir), JSON.stringify(an, null, 1));
console.log(`ok: ${an.destaques.length} destaques de ${col.itens.length} atos (${an.data})`);
