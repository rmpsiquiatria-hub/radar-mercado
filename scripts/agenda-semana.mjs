// Monday e-mail "Agenda da semana em Brasília": what is scheduled for the week, straight from the
// official open-data services (no AI; each item uses its official summary, the "ementa"):
//   1. Plenary agenda of the Câmara (dadosabertos.camara.leg.br) and of the Senado and Congresso
//      (legis.senado.leg.br/dadosabertos/plenario/agenda), Monday to Friday.
//   2. Medidas provisórias that lose validity in the next 14 days: the Congress calendar of each MP
//      in progress (legis.senado.leg.br/dadosabertos/processo, item "Deliberação da Medida Provisória").
//   3. STF plenary sessions of the week (portal.stf.jus.br/pauta/services), cases on taxes, labour
//      and benefits first.
//   4. Presidential vetoes waiting for the Congress (processo?sigla=VET&tramitando=S).
// A source that fails becomes a note in the e-mail instead of stopping it.
//   node scripts/agenda-semana.mjs --preview saida.html   → only writes the HTML
//   node scripts/agenda-semana.mjs                        → sends; needs GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO
import { readFile, writeFile } from "node:fs/promises";
import { sendGmail } from "./gmail.mjs";

const cfg = JSON.parse(await readFile(new URL("../relatorios/config.json", import.meta.url), "utf8"));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
async function get(url) {
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error(`${new URL(url).host} respondeu ${r.status}`);
  return r.json();
}
const arr = x => x == null ? [] : [].concat(x);

// The week: Monday to Friday containing today (Brasília).
const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
const seg = new Date(hoje); seg.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7));
const dias = [0, 1, 2, 3, 4].map(i => { const d = new Date(seg); d.setDate(seg.getDate() + i); return d; });
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hojeIso = iso(hoje), sexIso = iso(dias[4]);
const diaBR = s => new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
const ate = (s, n) => s && s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s || "";
// STF summaries come with HTML entities (&quot;): decoded here, escaped again when the HTML is built.
const limpa = s => String(s || "").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const linkSen = c => `https://www25.senado.leg.br/web/atividade/materias/-/materia/${c}`;

// 1a. Câmara: deliberative plenary sessions (órgão 180) and their agenda. An urgency request is shown
// as the bill it refers to.
async function camara() {
  const ev = await get(`https://dadosabertos.camara.leg.br/api/v2/orgaos/180/eventos?dataInicio=${iso(dias[0])}&dataFim=${sexIso}&itens=100`);
  const sessoes = ev.dados.filter(e => /deliberativa/i.test(e.descricaoTipo) && !/não deliberativa/i.test(e.descricaoTipo) && e.situacao !== "Cancelada");
  const itens = [], vistos = new Set();
  for (const s of sessoes) {
    const p = await get(`https://dadosabertos.camara.leg.br/api/v2/eventos/${s.id}/pauta`);
    for (const it of p.dados) {
      const urg = it.proposicao_?.siglaTipo === "REQ" && it.proposicaoRelacionada_;
      const pr = urg ? it.proposicaoRelacionada_ : it.proposicao_;
      if (!pr || (pr.siglaTipo === "REQ" && !urg)) continue;
      const id = `${pr.siglaTipo} ${pr.numero}/${pr.ano}`;
      if (vistos.has(id)) continue;
      vistos.add(id);
      itens.push({ dia: s.dataHoraInicio, id, ementa: limpa(pr.ementa), urgencia: !!urg, url: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${pr.id}` });
    }
  }
  return { sessoes: sessoes.length, itens };
}

// 1b. Senado and Congresso: one call per day. Congress (CN) sessions are where vetoes are voted.
async function senado() {
  const itens = [];
  for (const d of dias) {
    const j = await get(`https://legis.senado.leg.br/dadosabertos/plenario/agenda/dia/${iso(d).replace(/-/g, "")}.json`);
    for (const s of arr(j.AgendaPlenario?.Sessoes?.Sessao)) {
      if (!/deliberativa|conjunta/i.test(s.TipoSessao) && s.Casa !== "CN") continue;
      for (const m of arr(s.Materias?.Materia)) {
        if (m.SiglaMateria === "REQ") continue;
        itens.push({ dia: s.Data, casa: s.Casa, id: m.DescricaoIdentificacaoMateria, codigo: m.CodigoMateria, ementa: limpa(m.Ementa), url: linkSen(m.CodigoMateria) });
      }
    }
  }
  return itens;
}

// 2. MPs: the deadline of each MP in progress. "fim" of the deliberation item is the end of the first
// 60 days (extended automatically once) or, when prazoProrrogado is "Sim", the final day.
async function mps() {
  const lista = (await get("https://legis.senado.leg.br/dadosabertos/processo?sigla=MPV&tramitando=S"))
    .filter(m => +m.identificacao.match(/\/(\d{4})$/)?.[1] >= new Date().getFullYear() - 1);
  const out = [];
  for (const m of lista) {
    const p = await get(`https://legis.senado.leg.br/dadosabertos/processo/${m.id}`);
    const it = arr(p.itensCalendario).find(i => /Deliberação da Medida Provisória/i.test(i.descricaoItem));
    if (!it?.fim) continue;
    out.push({ id: m.identificacao, ementa: limpa(m.ementa), fim: it.fim, final: it.prazoProrrogado === "Sim", situacao: limpa(p.situacaoAtual || m.situacaoAtual), url: linkSen(m.codigoMateria) });
  }
  return out.sort((a, b) => a.fim.localeCompare(b.fim));
}

// 3. STF: plenary ("TP") sessions of each day. Cases about taxes, labour or benefits go first.
const TEMA_STF = /tribut|impost|icms|iss\b|ipi\b|pis\b|cofins|contribui[çc][ãa]o|previd|inss|aposentad|benef[íi]ci|trabalh|sal[áa]ri|servidor|fgts|sindic/i;
async function stf() {
  const itens = [];
  for (const d of dias) {
    const br = d.toLocaleDateString("pt-BR");
    const j = await get(`https://portal.stf.jus.br/pauta/services/calendario-service.asp?dados=sessao-presencial&data=${br}`);
    for (const c of arr(j.colegiados).filter(c => c.codigo === "TP"))
      for (const s of arr(c.sessoes))
        for (const i of arr(s.incidentes))
          itens.push({ dia: iso(d), id: `${i.classe} ${i.numero}`, relator: limpa(i.relator).replace(/^MIN\. /, "").toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase()),
            resumo: limpa(i.resumoTema).replace(/^1\.\s*/, "").replace(/^Trata-se de /i, ""), rg: !!i.repercussaoGeral, tema: TEMA_STF.test(i.resumoTema || ""),
            url: `https://portal.stf.jus.br/processos/listarProcessos.asp?classe=${i.classe}&numeroProcesso=${i.numero}` });
  }
  return itens.sort((a, b) => b.tema - a.tema || a.dia.localeCompare(b.dia));
}

// 4. Vetoes waiting for the Congress.
async function vetos() {
  const l = await get("https://legis.senado.leg.br/dadosabertos/processo?sigla=VET&tramitando=S");
  return l.map(v => ({ id: v.identificacao, ano: +v.identificacao.match(/\/(\d{4})$/)?.[1], data: v.dataApresentacao, ementa: limpa(v.ementa), situacao: limpa(v.situacaoAtual), codigo: v.codigoMateria, url: linkSen(v.codigoMateria) }))
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
}

const fontes = { camara, senado, mps, stf, vetos };
const r = {}, falhas = [];
for (const [k, f] of Object.entries(fontes)) {
  try { r[k] = await f(); } catch (e) { r[k] = null; falhas.push(`${k}: ${e.message}`); console.error(`Falha em ${k}:`, e.message); }
}

// HTML (same look as the other e-mails)
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MUTED = "#5d6b76", LINE = "#e3e8ec", NAVY = "#1e3a8a";
const h2 = t => `<h2 style="font-size:17px;margin:26px 0 8px;padding-bottom:6px;border-bottom:2px solid ${LINE}">${t}</h2>`;
const hint = t => `<p style="margin:0 0 8px;color:${MUTED};font-size:13px">${t}</p>`;
const vazio = t => `<p style="margin:4px 0;color:${MUTED};font-size:14px">${t}</p>`;
const erro = n => `<div style="background:#fdecea;border-radius:8px;padding:8px 12px;font-size:13px;margin:6px 0">Não foi possível ler ${n} hoje. Veja no site oficial.</div>`;
const item = (titulo, url, tag, texto, extra = "") => `<li style="margin:0 0 9px;font-size:14px"><a href="${esc(url)}" style="color:${NAVY};font-weight:700;text-decoration:none">${esc(titulo)}</a>${tag ? ` <span style="color:${MUTED};font-size:12px">· ${tag}</span>` : ""}${extra}<br><span style="font-size:13px">${esc(texto)}</span></li>`;
const ul = l => `<ul style="padding-left:18px;margin:4px 0">${l.join("")}</ul>`;
const sub = t => `<div style="font-size:14px;font-weight:700;margin:12px 0 2px">${t}</div>`;

// 1
let s1 = "";
if (r.camara) {
  s1 += sub("🏛️ Câmara dos Deputados");
  s1 += r.camara.itens.length ? ul(r.camara.itens.map(i => item(i.id, i.url, diaBR(i.dia) + (i.urgencia ? " · pedido de urgência" : ""), ate(i.ementa, 260))))
    : vazio(r.camara.sessoes ? "As sessões marcadas ainda não têm pauta publicada." : "Nenhuma sessão de votação marcada até agora. A Câmara costuma publicar a pauta na véspera; acompanhe em <a href=\"https://www.camara.leg.br/agenda\" style=\"color:" + NAVY + "\">camara.leg.br/agenda</a>.");
} else s1 += erro("a pauta da Câmara");
if (r.senado) {
  const sf = r.senado.filter(i => i.casa !== "CN"), cn = r.senado.filter(i => i.casa === "CN");
  s1 += sub("🏛️ Senado Federal");
  s1 += sf.length ? ul(sf.map(i => item(i.id, i.url, diaBR(i.dia), ate(i.ementa, 260)))) : vazio("Nenhuma votação marcada no plenário do Senado.");
  if (cn.length) s1 += sub("🏛️ Congresso Nacional (sessão conjunta)") + ul(cn.map(i => item(i.id, i.url, diaBR(i.dia), ate(i.ementa, 260))));
} else s1 += erro("a pauta do Senado");

// 2
let s2 = "";
if (r.mps) {
  const lim = new Date(hoje); lim.setDate(hoje.getDate() + 14); const limIso = iso(lim);
  const finais = r.mps.filter(m => m.final && m.fim >= hojeIso && m.fim <= limIso);
  const prim = r.mps.filter(m => !m.final && m.fim >= hojeIso && m.fim <= limIso);
  s2 += finais.length ? ul(finais.map(m => item(m.id, m.url, `<b style="color:#c9302c">perde a validade em ${diaBR(m.fim)}</b>`, ate(m.ementa, 240), `<br><span style="color:${MUTED};font-size:12px">${esc(m.situacao.toLowerCase())}</span>`)))
    : vazio("Nenhuma MP perde a validade nas próximas 2 semanas.");
  if (prim.length) s2 += hint(`Fecham os primeiros 60 dias (e passam automaticamente para mais 60): ${prim.map(m => `<a href="${esc(m.url)}" style="color:${NAVY}">${esc(m.id)}</a> em ${diaBR(m.fim)}`).join(", ")}.`);
  const prox = r.mps.find(m => m.final && m.fim > limIso);
  if (!finais.length && prox) s2 += hint(`A próxima a vencer é a ${esc(prox.id)}, em ${diaBR(prox.fim)}.`);
  s2 += hint(`${r.mps.length} MPs em tramitação.`);
} else s2 += erro("os prazos das MPs");

// 3
let s3 = "";
if (r.stf) {
  s3 += r.stf.length ? ul(r.stf.map(i => item(i.id, i.url, `${diaBR(i.dia)} · relator: ${esc(i.relator)}${i.rg ? " · repercussão geral" : ""}${i.tema ? ` · <b style="color:#b26b00">impostos, trabalho ou benefícios</b>` : ""}`, ate(i.resumo, 300))))
    : vazio("Nenhuma sessão de julgamento presencial do plenário marcada nesta semana.");
  s3 += hint(`Só o plenário presencial. O plenário virtual julga dezenas de casos por semana: <a href="https://portal.stf.jus.br/pauta/pesquisarCalendario.asp" style="color:${NAVY}">calendário do STF</a>.`);
} else s3 += erro("a pauta do STF");

// 4
let s4 = "";
if (r.vetos) {
  const naPauta = new Set((r.senado || []).filter(i => i.casa === "CN").map(i => String(i.codigo)));
  const pauta = r.vetos.filter(v => naPauta.has(String(v.codigo)));
  const recentes = r.vetos.filter(v => !naPauta.has(String(v.codigo))).slice(0, 10);
  const trancando = r.vetos.filter(v => /SOBRESTANDO/i.test(v.situacao)).length;
  s4 += hint(`${r.vetos.length} vetos aguardam votação do Congresso${trancando ? `, ${trancando} deles já trancando a pauta (passaram dos 30 dias)` : ""}. Para derrubar um veto são precisos 257 deputados e 41 senadores.`);
  if (pauta.length) s4 += sub("Na pauta desta semana") + ul(pauta.map(v => item(v.id, v.url, "", ate(v.ementa, 260))));
  s4 += sub("Os mais recentes") + ul(recentes.map(v => item(v.id, v.url, v.data ? diaBR(v.data) : "", ate(v.ementa, 260))));
} else s4 += erro("a lista de vetos");

const semana = `${dias[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} a ${dias[4].toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
const nVot = (r.camara?.itens.length || 0) + (r.senado?.length || 0);
const subject = `🗓️ Agenda da semana em Brasília · ${semana} · ${nVot} votações marcadas`;
const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#17212b">
<div style="max-width:680px;margin:0 auto;background:#fff;padding:20px 22px">
  <div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em">Radar de leis · início de semana</div>
  <h1 style="font-size:22px;margin:4px 0 2px">🗓️ Agenda da semana em Brasília</h1>
  ${hint(`Semana de ${semana}. Pautas como estavam publicadas na segunda de manhã: costumam mudar durante a semana.`)}
  ${h2("1. Votações marcadas no Congresso")}${s1}
  ${h2("2. Medidas provisórias perto de vencer")}${hint("Uma MP vale por 60 dias, prorrogados automaticamente por mais 60. Se o Congresso não votar até o fim do prazo, ela perde a validade e a regra deixa de valer.")}${s2}
  ${h2("3. Julgamentos no STF")}${s3}
  ${h2("4. Vetos pendentes")}${hint("Quando o Congresso derruba um veto, o trecho que o presidente tinha cortado volta a valer como lei.")}${s4}
  <p style="font-size:12px;color:#8c99a3;margin-top:22px">Coleta automática dos dados abertos da Câmara, do Senado e do STF, sem IA: os resumos são as ementas oficiais. Não é orientação jurídica. Mais em <a href="${esc(cfg.site)}" style="color:${NAVY}">Radar do Mercado</a>.</p>
</div></body></html>`;
const text = [subject, "", `Câmara: ${r.camara ? r.camara.itens.map(i => i.id).join(", ") || "sem pauta ainda" : "falhou"}`,
  `Senado/Congresso: ${r.senado ? r.senado.map(i => i.id).join(", ") || "sem votações" : "falhou"}`,
  `STF: ${r.stf ? r.stf.map(i => i.id).join(", ") || "sem sessão presencial" : "falhou"}`, "", `Site: ${cfg.site}`].join("\n");

const args = process.argv.slice(2);
if (args[0] === "--preview") {
  await writeFile(args[1] || "agenda-preview.html", html);
  console.log(`Prévia gravada em ${args[1] || "agenda-preview.html"} — assunto: ${subject}${falhas.length ? " — falhas: " + falhas.join("; ") : ""}`);
} else {
  if (Object.values(r).every(x => x === null)) { console.error("Todas as fontes falharam; não envia."); process.exit(1); }
  const { GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !EMAIL_TO) { console.error("Faltam GMAIL_USER, GMAIL_APP_PASSWORD ou EMAIL_TO."); process.exit(1); }
  await sendGmail({ user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s/g, ""), to: EMAIL_TO, subject, html, text, from: "Radar de leis" });
  console.log(`E-mail enviado — ${subject}`);
}
