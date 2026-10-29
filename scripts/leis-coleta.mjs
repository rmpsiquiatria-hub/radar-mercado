// Radar de leis, step 1: lists everything normative published on one day (no AI).
//   node scripts/leis-coleta.mjs [AAAA-MM-DD]   (default: today in Brasília)
// Sources:
//   federal   Diário Oficial da União, Seção 1 (+ extra edition), in.gov.br "leiturajornal" index
//             and each act's page for the full text; Seções 2 (people) and 3 (contracts, tenders,
//             companies) only as a list (lista: true), for the site's filters;
//   estadual  Diário Oficial do RS, the site's own REST backend (doe-backend.pro.rs.gov.br); personnel
//             acts, contracts, tenders and the like (EXCLUIR_RS) only as a list, from the list's snippet;
//   municipal Diário Oficial Eletrônico de Lajeado (Thema GRP, a JSF app): the edition's PDF,
//             turned into text by pdftotext and split at each act's heading.
// Writes relatorios/leis/coleta.json (index: title, summary, link, categories) and relatorios/leis/
// textos/<esfera>.txt (full texts, "=== <id> ===" separated, capped per act) for the analysis routine.
// List-only acts are left out of the texts and of the triage: they are never highlights.
// A source that fails is recorded in coleta.json and the others still go out.

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { categorias } from "./leis-categorias.mjs";

const dia = process.argv[2] || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const [Y, M, D] = dia.split("-");
const UA = { "User-Agent": "Mozilla/5.0 (radar-mercado; coleta diaria de leis)" };
const MAX_TEXTO = 15000;   // characters kept per act (long annexes are cut)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const limpa = s => String(s || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/h\d>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
async function get(url, opt = {}, tent = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { ...opt, headers: { ...UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r;
    } catch (e) { if (i >= tent) throw e; await sleep(2000 * i); }
  }
}
async function pool(list, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]).catch(e => ({ erro: String(e.message || e) })); } }));
  return out;
}

/* ---------- federal: DOU ---------- */
const SECOES_DOU = { do1: "DOU", do1e: "DOU (extra)", do2: "DOU Seção 2", do3: "DOU Seção 3" };
async function dou() {
  const itens = [];
  for (const secao of Object.keys(SECOES_DOU)) {
    const h = await (await get(`https://www.in.gov.br/leiturajornal?data=${D}-${M}-${Y}&secao=${secao}`)).text();
    const m = h.match(/<script id="params" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) throw new Error("índice do DOU sem dados (" + secao + ")");
    for (const x of JSON.parse(m[1]).jsonArray || []) itens.push({
      id: "dou-" + x.urlTitle.match(/(\d+)$/)?.[1], esfera: "federal", fonte: SECOES_DOU[secao], ...(/^do[23]/.test(secao) ? { lista: true } : {}),
      tipo: x.artType, orgao: x.hierarchyList?.[0] || x.hierarchyStr,
      unidade: x.hierarchyList?.length > 1 ? x.hierarchyList[0] + " / " + x.hierarchyList.at(-1) : x.hierarchyStr, titulo: x.title || x.titulo,
      ementa: (x.content || "").replace(/\s+/g, " ").replace((x.title || "").replace(/\s+/g, " "), "").trim(), url: "https://www.in.gov.br/web/dou/-/" + x.urlTitle, pagina: x.numberPage,
    });
  }
  const normas = itens.filter(it => !it.lista);
  const textos = await pool(normas, 4, async it => {
    const h = await (await get(it.url)).text();
    const i = h.indexOf('class="texto-dou"'); if (i < 0) return "";
    return limpa(h.slice(i, h.indexOf("</article>", i) > 0 ? h.indexOf("</article>", i) : i + 200000).replace(/^[^>]*>/, ""));
  });
  normas.forEach((it, k) => { it.texto = typeof textos[k] === "string" ? textos[k] : ""; });
  return itens;
}

/* ---------- estadual: DOE-RS ---------- */
const RS = "https://doe-backend.pro.rs.gov.br/public/";
// Not norms: people (hiring, leave, retirement), contracts, tenders, notices and company filings.
const EXCLUIR_RS = /recursos humanos|atos de pessoal|contratos?|licita|editais|edital|conv[eê]nios|homologa|transfer[eê]ncias volunt|extratos?|atas|aviso/i;
async function doeRS() {
  const q = p => `${RS}materias/?page=${p}&tipoDiario=DOE&dataIni=${dia}&dataFim=${dia}`;
  const first = await (await get(q(1))).json();
  const total = first.collectionSize || 0, pags = Math.ceil(total / (first.pageSize || 10));
  const lista = [...first.collection];
  const resto = await pool(Array.from({ length: Math.max(0, pags - 1) }, (_, i) => i + 2), 4, async p => (await (await get(q(p))).json()).collection);
  resto.forEach(c => Array.isArray(c) && lista.push(...c));
  const normas = lista.filter(m => !EXCLUIR_RS.test(m.tipoMateria || ""));
  // the rest only from the list's 500-character snippet (a detail call each would be ~900 more requests)
  const outros = lista.filter(m => EXCLUIR_RS.test(m.tipoMateria || "")).map(m => {
    const linhas = limpa(m.texto).split("\n").map(s => s.trim()).filter(s => s && !/^ESTADO DO RIO GRANDE DO SUL$/i.test(s));
    if (/prefeitura municipal|munic[íi]pio de/i.test(linhas.slice(0, 3).join(" ")) && !/lajeado/i.test(linhas.join(" "))) return null;
    const titulo = linhas.find(s => /\bn[º°o]\.?\s*\d|^(contrato|extrato|edital|aviso|termo|portaria|ata|s[úu]mula)/i.test(s) && s.length < 200) || linhas[0] || m.tipoMateria;
    return { id: "rs-" + m.id, esfera: "estadual", fonte: "DOE-RS", lista: true, tipo: m.tipoMateria, orgao: "", titulo: titulo.slice(0, 200),
      ementa: linhas.filter(s => s !== titulo).join(" ").slice(0, 250), url: "https://www.diariooficial.rs.gov.br/materia?id=" + m.id };
  }).filter(Boolean);
  const det = await pool(normas, 4, async m => (await get(RS + "materias/" + m.id)).json());
  // Other cities also publish in the state gazette; only Lajeado's are kept (its own gazette is read below anyway).
  const fora = (m, k) => det[k]?.tipoEntidade === "PREFEITURA" && !/lajeado/i.test(det[k].nomeEntidade || "");
  return { total, itens: normas.map((m, k) => {
    if (fora(m, k)) return null;
    const d = det[k] && !det[k].erro ? det[k] : {};
    const texto = limpa(d.conteudo || m.texto);
    const linhas = texto.split("\n").map(s => s.trim()).filter(s => s && !/^ESTADO DO RIO GRANDE DO SUL$/i.test(s));
    // title: the act's own heading ("DECRETO Nº 58.123, DE ...", "Portaria SES nº 512/2026"), not the
    // department name that usually comes first
    const topo = linhas.slice(0, 10);
    const titulo = topo.find(s => /^(LEI|DECRETO|PORTARIA|RESOLU|INSTRU|DELIBERA|ORDEM|ATO|PARECER|S[ÚU]MULA|EMENDA|EDITAL|ATA|AVISO|NOMEA)/i.test(s) && s.length < 200)
      || topo.find(s => /\bn[º°o]\.?\s*\d/i.test(s) && s.length < 200) || topo.find(s => s !== s.toUpperCase()) || linhas[0] || m.tipoMateria;
    return { id: "rs-" + m.id, esfera: "estadual", fonte: "DOE-RS", tipo: d.nomeTipoMateria || m.tipoMateria, orgao: d.nomeEntidade || "",
      unidade: d.nomeEntidadeCliente || "", titulo: titulo.slice(0, 200), ementa: linhas.filter(s => s !== titulo).slice(0, 3).join(" ").slice(0, 400),
      url: "https://www.diariooficial.rs.gov.br/materia?id=" + m.id, texto };
  }).filter(Boolean).concat(outros) };
}

/* ---------- municipal: Lajeado ---------- */
const GRP = "https://grp.lajeado.rs.gov.br";
async function lajeado() {
  const jar = {};
  const req = async (url, opt = {}) => {
    const r = await fetch(url, { ...opt, redirect: "manual", signal: AbortSignal.timeout(90000), headers: { ...UA, Cookie: Object.entries(jar).map(([k, v]) => k + "=" + v).join("; "), ...(opt.headers || {}) } });
    for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(";")[0], i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    if (r.status >= 300 && r.status < 400) return req(new URL(r.headers.get("location"), url).href);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return { r, url };
  };
  const action = (h, url) => new URL(h.match(/<form id="form"[^>]*action="([^"]+)"/)[1].replace(/&amp;/g, "&"), url).href;
  const campos = h => Object.fromEntries([...h.slice(h.indexOf('<form id="form"'), h.indexOf("</form>", h.indexOf('<form id="form"'))).matchAll(/<input[^>]*>/g)]
    .map(m => [m[0].match(/name="([^"]+)"/)?.[1], (m[0].match(/value="([^"]*)"/) || [, ""])[1], m[0]]).filter(x => x[0] && !/type="(submit|button|checkbox)"/.test(x[2])).map(x => [x[0], x[1]]));
  const post = (url, f) => req(url, { method: "POST", body: new URLSearchParams(f), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  // The service page is a launcher that posts itself into the gazette program.
  const start = GRP + "/erp/acessoexterno/programaAcessoExterno.faces?codigo=704084";
  let { r, url } = await req(start); let h = await r.text();
  ({ r, url } = await post(action(h, url), { "form:j_id_17": "{codigo=704084}", "form:j_id_18": start, "form:acao": "acao", form_SUBMIT: "1", "javax.faces.ViewState": h.match(/name="javax.faces.ViewState" value="([^"]*)"/)[1] }));
  const lista = await r.text(), listaUrl = url;
  const eds = [...lista.matchAll(/id="(form:[^"]+)"[^>]*rel="diarioOficialEdicao"[\s\S]*?title="Edi[^"]{1,20}o (\d+)"[\s\S]*?>(\d\d)\/(\d\d)\/(\d{4})<[\s\S]*?class="badge[^"]*">([^<]*)</g)]
    .map(m => ({ link: m[1], numero: m[2], data: `${m[5]}-${m[4]}-${m[3]}`, tipo: m[6], registro: m[1].match(/:(\d+):/)[1] }));
  if (!eds.length) throw new Error("lista de edições vazia");
  const doDia = eds.filter(e => e.data === dia);
  const itens = [];
  for (const e of doDia) {
    // each edition opens from the list page, so the list is loaded again for the next one
    const { r: r0, url: u0 } = itens.length ? await post(action(lista, listaUrl), campos(lista)) : { r: null, url: listaUrl };
    const base = r0 ? await r0.text() : lista;
    ({ r, url } = await post(action(base, u0), { ...campos(base), "form:_idcl": e.link, identificador: "diarioOficialEdicao", registro: e.registro }));
    const pag = await r.text();
    const src = pag.match(/(?:src|data)="([^"]*MediaOutputResource[^"]*)"/)?.[1]?.replace(/&amp;/g, "&");
    if (!src) throw new Error("PDF da edição " + e.numero + " não encontrado");
    const pdf = Buffer.from(await (await req(new URL(src, url).href)).r.arrayBuffer());
    const f = join(tmpdir(), `lajeado-${e.numero}.pdf`);
    await writeFile(f, pdf);
    const txt = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", f, "-"], { maxBuffer: 64 << 20 }).toString("utf8")
      .split("\n").filter(l => !/Di[áa]rio Oficial Eletr[ôo]nico Edi[çc][ãa]o \d+ +P[áa]gina/.test(l)).join("\n");
    itens.push(...atosLajeado(txt, e));
  }
  return { edicoes: doDia.map(e => `${e.numero} (${e.tipo})`), itens };
}
// Splits an edition's text at each act heading ("DECRETO Nº 14.449, DE 27 DE OUTUBRO DE 2026.").
function atosLajeado(txt, ed) {
  const re = /^\s*((?:LEI(?: COMPLEMENTAR| MUNICIPAL)?|DECRETO(?: LEGISLATIVO)?|PORTARIA|RESOLU[ÇC][ÃA]O|INSTRU[ÇC][ÃA]O NORMATIVA|EDITAL|AVISO|EXTRATO|ATA|ERRATA|RETIFICA[ÇC][ÃA]O|TERMO|ORDEM DE SERVI[ÇC]O)\b[^\n]{0,120}?N[º°o.]*\s*[\d.\/-]+[^\n]*)$/gmi;
  const heads = [...txt.matchAll(re)];
  const url = "https://www.lajeado.rs.gov.br/servico/704084/4975?titulo=Di%C3%A1rio+Oficial+Eletr%C3%B4nico";
  if (!heads.length) return [{ id: `laj-${ed.numero}`, esfera: "municipal", fonte: "DOM Lajeado", tipo: "Edição", orgao: "Prefeitura de Lajeado",
    titulo: `Edição ${ed.numero}`, ementa: "", url, texto: txt.trim() }];
  return heads.map((m, k) => {
    const corpo = txt.slice(m.index, heads[k + 1]?.index ?? txt.length);
    const linhas = corpo.split("\n").map(s => s.trim()).filter(Boolean);
    const titulo = linhas[0].replace(/\s+/g, " ");
    // the summary is the indented block right after the heading, before "A PREFEITA..." / "DECRETA"
    const ementa = linhas.slice(1, 8).join(" ").split(/\b(A PREFEITA|O PREFEITO|O PRESIDENTE|A PRESIDENTE|DECRETA|FAZ SABER)\b/)[0].trim().slice(0, 400);
    return { id: `laj-${ed.numero}-${k + 1}`, esfera: "municipal", fonte: `DOM Lajeado ed. ${ed.numero}`, tipo: titulo.split(/\s+N/)[0].replace(/\s+/g, " "),
      orgao: "Prefeitura de Lajeado", titulo, ementa, url, texto: linhas.join("\n") };
  });
}

/* ---------- run ---------- */
const dir = new URL("../relatorios/leis/", import.meta.url);
await mkdir(new URL("textos/", dir), { recursive: true });
const fontes = {}, itens = [];
for (const [nome, fn] of [["federal", dou], ["estadual", doeRS], ["municipal", lajeado]]) {
  try {
    const res = await fn(), lst = Array.isArray(res) ? res : res.itens;
    itens.push(...lst);
    fontes[nome] = { ok: true, atos: lst.filter(i => !i.lista).length, lista: lst.filter(i => i.lista).length, ...(res.total != null ? { publicados: res.total } : {}), ...(res.edicoes ? { edicoes: res.edicoes } : {}) };
    console.log(nome, lst.length);
  } catch (e) { fontes[nome] = { ok: false, erro: String(e.message || e) }; console.error(nome, "falhou:", e.message || e); }
}
// Weekends and holidays usually have nothing: keep the previous day's files, so the routine and the
// e-mail find a day already done and stop.
if (!itens.length) { console.log(`coleta de ${dia}: nada publicado; arquivos anteriores mantidos`); process.exit(0); }
for (const esf of ["federal", "estadual", "municipal"]) {
  const t = itens.filter(i => i.esfera === esf && !i.lista).map(i => `=== ${i.id} ===\n${i.titulo}\n${(i.texto || i.ementa || "").slice(0, MAX_TEXTO)}${(i.texto || "").length > MAX_TEXTO ? "\n[… texto cortado; íntegra no link]" : ""}\n`).join("\n");
  await writeFile(new URL(`textos/${esf}.txt`, dir), t);
}
// One line per act, for the analysis to pick what deserves a full read (the full index is too big).
const linha = i => [i.id, i.tipo, i.unidade || i.orgao, i.titulo, (i.ementa || "").replace(/\s+/g, " ").slice(0, 250)].map(x => String(x || "").replace(/\s*\|\s*/g, " / ")).join(" | ");
await writeFile(new URL("textos/triagem.txt", dir), [`Atos normativos publicados em ${dia} — id | tipo | órgão | título | começo do texto`,
  ...["federal", "estadual", "municipal"].flatMap(e => [``, `## ${e.toUpperCase()} (${itens.filter(i => i.esfera === e && !i.lista).length})${fontes[e]?.ok === false ? " — FONTE FALHOU: " + fontes[e].erro : ""}`, ...itens.filter(i => i.esfera === e && !i.lista).map(linha)])].join("\n") + "\n");
const index = { data: dia, coletado_em: new Date().toISOString(), fontes,
  itens: itens.map(({ texto, ...i }) => ({ ...i, unidade: i.unidade && i.unidade !== i.orgao ? i.unidade : undefined,
    ementa: (i.ementa || "").replace(/\s+/g, " ").slice(0, i.lista ? 250 : 400), cats: categorias(i), ...(i.lista ? {} : { tamanho: (texto || "").length }) })) };
await writeFile(new URL("coleta.json", dir), JSON.stringify(index, null, 1));
console.log(`coleta de ${dia}: ${itens.length} atos`);
if (!Object.values(fontes).some(f => f.ok)) process.exit(1);
