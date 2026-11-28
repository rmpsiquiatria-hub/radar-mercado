// Checks relatorios/leis/ultimo.json (the routine's analysis) against the day's collection and fills
// in title, agency, sphere and link from the ids, so links never come from the model.
// Also writes relatorios/leis/historico/<data>.json. Exits 1 with the problems listed.
//   node scripts/leis-validar.mjs --dia AAAA-MM-DD
// checks the analysis of a recovered day (relatorios/leis/atrasados/<dia>/, federal only) and joins it
// to that day's file in historico/, keeping the state and city parts analysed before.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { AREAS, areaDestaque } from "./leis-categorias.mjs";

const dir = new URL("../relatorios/leis/", import.meta.url);
const dia = process.argv[2] === "--dia" ? process.argv[3] : null;
if (process.argv[2] === "--dia" && !/^\d{4}-\d\d-\d\d$/.test(dia || "")) { console.error("--dia precisa de AAAA-MM-DD"); process.exit(1); }
const pasta = dia ? new URL(`atrasados/${dia}/`, dir) : dir;
const col = JSON.parse(await readFile(new URL("coleta.json", pasta), "utf8"));
const an = JSON.parse(await readFile(new URL("ultimo.json", pasta), "utf8"));
const esferas = dia ? ["federal"] : ["federal", "estadual", "municipal"];
const porId = new Map(col.itens.map(i => [i.id, i]));
const erros = [];
if (an.data !== col.data) erros.push(`data ${an.data} diferente da coleta (${col.data})`);
for (const e of esferas) if (typeof an.resumo?.[e] !== "string" || an.resumo[e].length < 10) erros.push(`resumo.${e} vazio ou curto demais`);
if (!Array.isArray(an.destaques)) erros.push("destaques precisa ser uma lista");
const vistos = new Set();
for (const [k, d] of (an.destaques || []).entries()) {
  const it = porId.get(d.id);
  if (it?.lista) { erros.push(`destaque ${k + 1}: "${d.id}" é só de lista (pessoal, contrato), não pode ser destaque`); continue; }
  if (!it) { erros.push(`destaque ${k + 1}: id "${d.id}" não existe na coleta`); continue; }
  if (vistos.has(d.id)) erros.push(`destaque ${k + 1}: id "${d.id}" repetido`);
  vistos.add(d.id);
  if (!["alta", "media"].includes(d.relevancia)) erros.push(`${d.id}: relevancia deve ser "alta" ou "media"`);
  if (d.area != null && !AREAS[d.area]) erros.push(`${d.id}: area deve ser ${Object.keys(AREAS).join(", ")}`);
  if (!d.o_que_muda || d.o_que_muda.length < 15) erros.push(`${d.id}: o_que_muda vazio`);
  if (d.imposto) {
    const t = d.imposto;
    if (!t.tributo || !t.depois || !t.antes) erros.push(`${d.id}: imposto precisa de tributo, antes e depois`);
    if (t.variacao_pct != null && typeof t.variacao_pct !== "number") erros.push(`${d.id}: imposto.variacao_pct deve ser número`);
    if (/exemplo/i.test(`${t.antes} ${t.depois}`)) erros.push(`${d.id}: imposto ainda com os valores de exemplo`);
  }
  Object.assign(d, { esfera: it.esfera, titulo: it.titulo, orgao: it.unidade || it.orgao, tipo: it.tipo, url: it.url, fonte: it.fonte });
  d.temas = Array.isArray(d.temas) ? d.temas : [];
  d.area = areaDestaque(d, it);
}
if (erros.length) { console.error("Problemas:\n- " + erros.join("\n- ")); process.exit(1); }
const ordem = { alta: 0, media: 1 }, esf = { federal: 0, estadual: 1, municipal: 2 };
const ordenar = l => l.sort((a, b) => ordem[a.relevancia] - ordem[b.relevancia] || esf[a.esfera] - esf[b.esfera]);
ordenar(an.destaques);
an.fontes = col.fontes;
an.coletado_em = col.coletado_em;   // a later collection of the same day (an edition out late) is analysed again
an.totais = Object.fromEntries(esferas.map(e => [e, col.itens.filter(i => i.esfera === e).length]));
await writeFile(new URL("ultimo.json", pasta), JSON.stringify(an, null, 1));
await mkdir(new URL("historico/", dir), { recursive: true });
const arquivo = new URL(`historico/${an.data}.json`, dir);
if (!dia) await writeFile(arquivo, JSON.stringify(an, null, 1));
else {
  const SEM = "Sem análise registrada neste dia.";
  const antes = await readFile(arquivo, "utf8").then(JSON.parse).catch(() => ({ data: dia, resumo: { estadual: SEM, municipal: SEM }, destaques: [], demais: {}, fontes: {}, totais: {}, coletado_em: col.coletado_em }));
  // Only the extra edition recovered: it adds to the federal part already there. Otherwise it replaces it.
  const repetido = antes.federal_recuperado_em === col.coletado_em;
  const junta = (a, b) => !col.parcial || !a ? b : repetido || !b ? a : `${a} ${b}`;
  const novos = new Set(an.destaques.map(d => d.id));
  const junto = { ...antes, gerado_em: an.gerado_em,
    resumo: { ...antes.resumo, federal: junta(antes.resumo?.federal, an.resumo.federal) },
    destaques: ordenar([...(antes.destaques || []).filter(d => !novos.has(d.id) && (col.parcial || d.esfera !== "federal")), ...an.destaques]),
    demais: { ...antes.demais, federal: junta(antes.demais?.federal, an.demais?.federal) },
    fontes: { ...antes.fontes, federal: col.fontes.federal },
    totais: { ...antes.totais, federal: !col.parcial ? an.totais.federal : repetido ? antes.totais?.federal : (antes.totais?.federal || 0) + an.totais.federal },
    federal_recuperado_em: col.coletado_em };
  await writeFile(arquivo, JSON.stringify(junto, null, 1));
}
console.log(`ok: ${an.destaques.length} destaques de ${col.itens.length} atos (${an.data}${dia ? ", recuperado" : ""})`);
