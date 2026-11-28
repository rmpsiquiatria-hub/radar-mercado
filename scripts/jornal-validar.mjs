// Confere a edição do jornal antes de publicar. Sai com 1 e lista os problemas.
//   node scripts/jornal-validar.mjs [AAAA-MM-DD]   (padrão: hoje em Brasília)
import { readFile } from "node:fs/promises";

const dia = process.argv[2] || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const SECOES = ["longevidade", "pets", "filmes", "esportes", "turismo", "moda", "guerras", "presidente"];
const IA = ["longevidade", "pets", "moda"];
const arquivo = new URL(`../relatorios/jornal/edicoes/${dia}.json`, import.meta.url);
const ed = JSON.parse(await readFile(arquivo, "utf8"));
const erros = [];
const texto = (v, min, max) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
const https = v => typeof v === "string" && v.length <= 600 && /^https:\/\/[^\s"'<>()]+(\([^\s"'<>()]*\)[^\s"'<>()]*)*$/.test(v);

if (ed.data !== dia) erros.push(`data "${ed.data}" diferente de ${dia}`);
if (!Array.isArray(ed.materias) || !ed.materias.length) erros.push("materias precisa ser uma lista com matérias");
if ((ed.materias || []).length > 80) erros.push("no máximo 80 matérias");
const ids = new Set(), titulos = new Set();
for (const [k, m] of (ed.materias || []).entries()) {
  const nome = `matéria ${k + 1} (${m.id || "sem id"})`;
  const e = t => erros.push(`${nome}: ${t}`);
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(m.id || "")) e("id inválido (minúsculas, números e hífen)");
  if (ids.has(m.id)) e("id repetido");
  ids.add(m.id);
  if (!SECOES.includes(m.secao)) { e(`seção "${m.secao}" não existe`); continue; }
  if (!texto(m.titulo, 8, 200)) e("título precisa ter de 8 a 200 caracteres");
  const t = String(m.titulo || "").trim().toLowerCase();
  if (titulos.has(t)) e("título repetido");
  titulos.add(t);
  if (/<[a-z/!]/i.test(`${m.titulo} ${m.resumo || ""} ${m.texto || ""}`)) e("sem HTML");
  if (m.secao === "filmes") {
    if (!texto(m.texto, 80, 2200)) e("texto de filme precisa ter de 80 a 2.200 caracteres");
    if (m.resumo || m.imagem || m.fontes?.length) e("filme não tem resumo, imagem nem fontes");
    continue;
  }
  if (!texto(m.texto, 200, 12000)) e("texto precisa ter de 200 a 12.000 caracteres");
  if (/!\[/.test(m.texto || "") || /^## *fontes/im.test(m.texto || "")) e("sem imagens e sem seção Fontes no texto");
  if (!texto(m.resumo, 20, 500)) e("resumo precisa ter de 20 a 500 caracteres");
  if (!Array.isArray(m.fontes) || !m.fontes.length || m.fontes.length > 10) e("de 1 a 10 fontes");
  else for (const f of m.fontes) if (!texto(f.nome, 2, 200) || !https(f.url) || (f.data && !/^\d{4}-\d\d-\d\d$/.test(f.data))) e(`fonte inválida: ${JSON.stringify(f).slice(0, 160)}`);
  const i = m.imagem;
  if (IA.includes(m.secao) && i?.tipo !== "ia") e("precisa de imagem do tipo ia");
  if (m.secao === "turismo" && i?.tipo !== "foto") e("turismo precisa de foto real");
  if (!i) continue;
  if (i.tipo === "ia") {
    if (!IA.includes(m.secao)) e("imagem de IA só em Saúde, Pets e Moda");
    if (!texto(i.cena, 40, 700)) e("cena precisa ter de 40 a 700 caracteres");
  } else if (i.tipo === "foto") {
    if (!https(i.url) || !i.url.startsWith("https://upload.wikimedia.org/")) e("foto só do Wikimedia Commons (https://upload.wikimedia.org/...)");
    if (!texto(i.credito, 5, 200) || !/wikimedia commons/i.test(i.credito)) e("crédito: Autor / Wikimedia Commons (licença)");
    if (i.legenda && !texto(i.legenda, 3, 200)) e("legenda com até 200 caracteres");
  } else e("imagem.tipo deve ser ia ou foto");
}
if (erros.length) { console.error("Problemas:\n- " + erros.join("\n- ")); process.exit(1); }
const n = s => ed.materias.filter(m => m.secao === s).length;
const faltam = SECOES.filter(s => !n(s));
if (faltam.length) console.log("Aviso: seções sem matéria:", faltam.join(", "));
if (n("moda") !== 2) console.log(`Aviso: Moda tem ${n("moda")} matéria(s); o combinado são 2 (mulheres e homens).`);
if (!ed.materias.some(m => m.secao === "guerras" && m.fixada)) console.log("Aviso: falta a lista fixada das guerras em Mundo.");
console.log(`ok: ${ed.materias.length} matérias em ${dia} (${SECOES.map(s => `${s} ${n(s)}`).join(", ")})`);
