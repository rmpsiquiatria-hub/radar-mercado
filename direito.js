// Educação → Direito: where Brazilian norms are published (federal, state of RS, Lajeado and
// others), how they rank, and the daily "Radar de leis" (relatorios/leis/*.json, written by the
// collector scripts/leis-coleta.mjs and the cloud routine's analysis).
// The texts were written by Claude in Oct/2026; the links were checked then.
(() => {
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const a = (url, txt) => `<a href="${url}" target="_blank" rel="noopener">${txt || url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>`;

const HIERARQUIA = [
  ["Constituição Federal e emendas", "A lei mais alta do país. Nada pode contrariá-la. Muda só por emenda constitucional (3/5 dos votos, em dois turnos, na Câmara e no Senado)."],
  ["Leis complementares", "Tratam de assuntos que a Constituição manda regular assim (ex.: regras gerais de impostos, Simples Nacional). Precisam de maioria absoluta."],
  ["Leis ordinárias e medidas provisórias", "A maior parte das leis. A medida provisória (MP) é editada pelo presidente e vale na hora, mas cai se o Congresso não a aprovar em até 120 dias."],
  ["Decretos", "Feitos pelo presidente, governador ou prefeito para regulamentar como uma lei será aplicada. Não podem criar obrigação que a lei não prevê."],
  ["Portarias, resoluções e instruções normativas", "Normas de ministérios, secretarias, agências e conselhos. Detalham procedimentos do dia a dia (ex.: como declarar o imposto de renda)."],
];

const GRUPOS = [
  { id: "federal", titulo: "🏛️ Federal: Constituição, leis e Diário Oficial", itens: [
    { titulo: "Diário Oficial da União (DOU)", sub: "Imprensa Nacional", link: "https://www.in.gov.br/",
      oque: "O jornal oficial do governo federal. Uma lei só passa a existir para todos depois de publicada aqui. Sai de segunda a sexta, com edições extras quando preciso.",
      publica: [["Seção 1", "leis, MPs, decretos, portarias, resoluções: as normas"], ["Seção 2", "atos de pessoal (nomeações, aposentadorias)"], ["Seção 3", "contratos, licitações e editais"]],
      dica: "É a fonte do radar diário: o robô lê toda a Seção 1." },
    { titulo: "Portal da Legislação do Planalto", sub: "Presidência da República", link: "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm",
      oque: "Onde ficam a Constituição, os códigos (Civil, Penal, Consumidor…) e todas as leis federais em texto <b>compilado</b>: já com as alterações posteriores incorporadas e as partes revogadas riscadas.",
      publica: [["Tem", "Constituição, códigos, leis, MPs e decretos federais"], ["Melhor para", "ler a versão atual de uma lei"]],
      dica: "Se a lei mudou várias vezes, é aqui que se vê o texto em vigor hoje." },
    { titulo: "Câmara dos Deputados", sub: "Poder Legislativo", link: "https://www.camara.leg.br/legislacao",
      oque: "Casa onde começa a maioria dos projetos de lei. O site mostra cada projeto, quem propôs, em que comissão está e como cada deputado votou.",
      publica: [["Tem", "projetos em andamento e a legislação federal"], ["Melhor para", "acompanhar uma lei antes de ela existir"]] },
    { titulo: "Senado Federal", sub: "Poder Legislativo", link: "https://legis.senado.leg.br/norma/",
      oque: "Revisa os projetos que vêm da Câmara (e vice-versa). O sistema de normas do Senado tem a legislação federal desde o Império, com notas sobre alterações.",
      publica: [["Tem", "normas federais, projetos e a Constituição anotada"], ["Melhor para", "histórico de uma lei e versões antigas"]] },
    { titulo: "Congresso Nacional", sub: "Sessões conjuntas", link: "https://www.congressonacional.leg.br/materias/medidas-provisorias",
      oque: "Câmara e Senado juntos analisam medidas provisórias, vetos do presidente e o orçamento.",
      publica: [["Tem", "MPs (prazo e situação), vetos, lei orçamentária"]] },
    { titulo: "LexML Brasil", sub: "Rede de informação legislativa", link: "https://www.lexml.gov.br/",
      oque: "Um buscador único que junta normas federais, estaduais e municipais, projetos de lei e decisões de tribunais de vários órgãos.",
      publica: [["Melhor para", "começar uma pesquisa quando não se sabe onde a norma está"]] },
  ]},
  { id: "orgaos", titulo: "🏢 Federal: normas de órgãos e agências", itens: [
    { titulo: "Receita Federal", sub: "Tributos federais", link: "http://normas.receita.fazenda.gov.br/sijut2consulta/consulta.action",
      oque: "Instruções normativas, atos declaratórios e soluções de consulta que dizem como pagar e declarar imposto de renda, PIS, Cofins, IOF e outros.",
      publica: [["Exemplo", "regras da declaração anual do IR"]] },
    { titulo: "Banco Central e Conselho Monetário Nacional", sub: "Sistema financeiro", link: "https://www.bcb.gov.br/estabilidadefinanceira/buscanormas",
      oque: "Resoluções e circulares sobre bancos, Pix, câmbio, cartão de crédito e juros.",
      publica: [["Exemplo", "limites do Pix noturno, regras do rotativo do cartão"]] },
    { titulo: "CVM", sub: "Mercado de capitais", link: "https://conteudo.cvm.gov.br/legislacao/index.html",
      oque: "A Comissão de Valores Mobiliários regula a bolsa, fundos de investimento, corretoras e empresas abertas.",
      publica: [["Exemplo", "regras dos fundos, divulgação de resultados das empresas"]] },
    { titulo: "Agências reguladoras", sub: "ANVISA, ANS, ANEEL, ANATEL, ANP…", link: "https://www.gov.br/anvisa/pt-br/assuntos/legislacao",
      oque: "Cada agência regula um setor: remédios e alimentos (ANVISA), planos de saúde (ANS), energia (ANEEL), telefonia (ANATEL), combustíveis (ANP). Suas resoluções saem no DOU.",
      publica: [["Exemplo", "rol de coberturas dos planos de saúde (ANS)"]] },
    { titulo: "Conselhos profissionais", sub: "CFM, OAB, CFP, CFC…", link: "https://portal.cfm.org.br/buscar-normas-cfm-e-crm/",
      oque: "Os conselhos federais regulam o exercício de cada profissão: ética, publicidade, telemedicina. O link leva às normas do Conselho Federal de Medicina e dos CRMs.",
      publica: [["Exemplo", "resoluções do CFM sobre prescrição e telemedicina"]] },
    { titulo: "CONFAZ", sub: "ICMS entre os estados", link: "https://www.confaz.fazenda.gov.br/",
      oque: "Conselho dos secretários de Fazenda dos estados. Seus convênios definem benefícios e regras do ICMS que valem entre estados.",
      publica: [["Exemplo", "convênios de ICMS sobre combustíveis e medicamentos"]] },
    { titulo: "Normas Regulamentadoras (NRs)", sub: "Segurança e saúde no trabalho", link: "https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes",
      oque: "As NRs do Ministério do Trabalho são obrigatórias para empresas com empregados: equipamentos de proteção, exames ocupacionais, ergonomia.",
      publica: [["Exemplo", "NR-7 (exames médicos ocupacionais), NR-32 (serviços de saúde)"]] },
  ]},
  { id: "judiciario", titulo: "⚖️ Judiciário: decisões que valem como regra", itens: [
    { titulo: "STF: súmulas vinculantes", sub: "Supremo Tribunal Federal", link: "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26",
      oque: "O Supremo interpreta a Constituição. Suas <b>súmulas vinculantes</b> e decisões em repercussão geral obrigam todos os juízes e a administração pública, funcionando na prática como lei.",
      publica: [["Exemplo", "Súmula Vinculante 13 (proíbe nepotismo)"]] },
    { titulo: "STJ: súmulas e recursos repetitivos", sub: "Superior Tribunal de Justiça", link: "https://scon.stj.jus.br/SCON/",
      oque: "Uniformiza a interpretação das leis federais (Código Civil, do Consumidor…). Os temas repetitivos orientam todos os tribunais do país.",
      publica: [["Exemplo", "regras sobre juros bancários e planos de saúde"]] },
    { titulo: "CNJ: atos normativos", sub: "Conselho Nacional de Justiça", link: "https://atos.cnj.jus.br/",
      oque: "Resoluções que organizam o funcionamento da Justiça: cartórios, processos eletrônicos, custas.",
      publica: [["Exemplo", "regras de cartórios para divórcio e inventário extrajudicial"]] },
  ]},
  { id: "estadual", titulo: "🧉 Estadual: Rio Grande do Sul", itens: [
    { titulo: "Diário Oficial do Estado (DOE-RS)", sub: "Governo do RS", link: "https://www.diariooficial.rs.gov.br/",
      oque: "O jornal oficial do estado. Publica leis estaduais sancionadas pelo governador, decretos, portarias das secretarias e também atos de pessoal, contratos e licitações.",
      publica: [["Normas", "leis, decretos, resoluções, portarias, instruções normativas"], ["Outros", "pessoal, contratos, licitações (fora do radar)"]],
      dica: "É fonte do radar diário: o robô lê todos os atos normativos." },
    { titulo: "Assembleia Legislativa (ALRS)", sub: "Poder Legislativo estadual", link: "https://www.al.rs.gov.br/legislativo",
      oque: "Onde os deputados estaduais votam as leis do RS. O sistema de legislação estadual traz o texto das leis, inclusive a Constituição do Estado.",
      publica: [["Tem", "leis estaduais, projetos, Constituição do RS"]] },
    { titulo: "Receita Estadual do RS", sub: "Secretaria da Fazenda", link: "https://receita.fazenda.rs.gov.br/inicial",
      oque: "Regulamento do ICMS, IPVA e ITCD (imposto sobre herança e doação) e as instruções da Receita gaúcha.",
      publica: [["Exemplo", "alíquotas de ICMS e calendário do IPVA"]] },
    { titulo: "TJRS e TCE-RS", sub: "Tribunais estaduais", link: "https://www.tjrs.jus.br/",
      oque: "O Tribunal de Justiça julga as causas no estado e publica a jurisprudência gaúcha. O Tribunal de Contas (" + a("https://www.tce.rs.gov.br/", "TCE-RS") + ") fiscaliza as contas do estado e dos municípios.",
      publica: [["Melhor para", "entender como a Justiça gaúcha aplica uma lei"]] },
  ]},
  { id: "municipal", titulo: "🏘️ Municipal: Lajeado", itens: [
    { titulo: "Diário Oficial Eletrônico de Lajeado", sub: "Prefeitura Municipal", link: "https://www.lajeado.rs.gov.br/servico/704084/4975?titulo=Di%C3%A1rio+Oficial+Eletr%C3%B4nico",
      oque: "Desde 01/06/2026 em sistema novo. Publica leis municipais sancionadas pela prefeita, decretos, portarias e editais.",
      publica: [["Normas", "leis, decretos, portarias"], ["Exemplo", "regras de trânsito, IPTU, licenças, eventos"]],
      dica: "É fonte do radar diário: o robô lê a edição inteira." },
    { titulo: "Câmara de Vereadores de Lajeado", sub: "Poder Legislativo municipal", link: "https://lajeado.rs.leg.br/",
      oque: "Onde os vereadores votam as leis municipais, inclusive a <b>Lei Orgânica</b> (a \"constituição\" do município), o Plano Diretor e o orçamento.",
      publica: [["Tem", "projetos em votação, leis municipais, Lei Orgânica"]] },
    { titulo: "Querido Diário", sub: "Projeto aberto (Open Knowledge Brasil)", link: "https://queridodiario.ok.org.br/",
      oque: "Reúne e permite buscar os diários oficiais de centenas de municípios brasileiros num só lugar, de graça.",
      publica: [["Melhor para", "pesquisar um assunto em várias cidades ao mesmo tempo"]] },
  ]},
  { id: "outros", titulo: "🌐 Outros lugares onde há regras obrigatórias", itens: [
    { titulo: "Tratados internacionais", sub: "Itamaraty", link: "https://concordia.itamaraty.gov.br/",
      oque: "Acordos assinados pelo Brasil. Depois de aprovados pelo Congresso e promulgados por decreto, valem como lei (os de direitos humanos podem ter força de emenda constitucional).",
      publica: [["Exemplo", "acordos para evitar bitributação, Mercosul"]] },
    { titulo: "Convenções coletivas de trabalho", sub: "Sindicatos e Ministério do Trabalho", link: "https://www.gov.br/trabalho-e-emprego/pt-br",
      oque: "Acordos entre sindicatos de empregados e de empresas que valem para toda a categoria: piso salarial, reajuste, jornada. São registradas no sistema Mediador do Ministério do Trabalho.",
      publica: [["Exemplo", "piso salarial dos comerciários de uma região"]] },
    { titulo: "Normas técnicas (ABNT)", sub: "Associação Brasileira de Normas Técnicas", link: "https://www.abnt.org.br/",
      oque: "Padrões técnicos (tomadas, acessibilidade, construção). Em geral são pagas e voluntárias, mas viram obrigatórias quando uma lei ou o INMETRO manda segui-las.",
      publica: [["Exemplo", "NBR 9050, de acessibilidade em edificações"]] },
  ]},
];

const GLOSSARIO = [
  ["Sanção e veto", "Depois de aprovada, a lei vai ao chefe do Executivo, que concorda (sanciona) ou rejeita no todo ou em parte (veta). O Legislativo pode derrubar o veto."],
  ["Vacatio legis", "Prazo entre a publicação e o início da vigência. Se a lei não disser nada, são 45 dias. Muitas dizem \"entra em vigor na data de sua publicação\"."],
  ["Revogação", "Quando uma norma nova acaba com uma antiga, no todo (ab-rogação) ou em parte (derrogação)."],
  ["Texto compilado", "Versão da lei com todas as alterações já aplicadas. O texto publicado no Diário Oficial é o original daquele dia."],
  ["Ementa", "O resumo oficial que vem no topo de cada norma, dizendo do que ela trata."],
  ["Competência", "Quem pode fazer lei sobre o quê: a União cuida de direito civil, penal, trabalhista; estados e municípios, de seus impostos e serviços; algumas matérias são comuns."],
];

function dirEducacao() {
  const card = it => `<article class="card edu">
      <div class="edu-h"><div><h3>${it.titulo}</h3><div class="hint">${it.sub}</div></div></div>
      <p style="margin-top:8px">${it.oque}</p>
      ${it.publica ? `<table class="edu-t" style="margin-top:8px">${it.publica.map(([x, y]) => `<tr><td>${x}</td><td>${y}</td></tr>`).join("")}</table>` : ""}
      ${it.dica ? `<p class="hint" style="margin-top:8px">📡 ${it.dica}</p>` : ""}
      <p style="margin-top:10px;font-size:14px">🔗 ${a(it.link, "Abrir o site")}</p>
    </article>`;
  return `
    <h3 class="dir-h">📐 A hierarquia das normas</h3>
    <p class="hint">Uma norma de baixo nunca pode contrariar uma de cima. Leis federais, estaduais e municipais não ficam umas acima das outras: cada nível cuida dos assuntos que a Constituição lhe dá.</p>
    <ol class="dir-hier">${HIERARQUIA.map(([t, d], i) => `<li style="--i:${i}"><b>${t}</b><span>${d}</span></li>`).join("")}</ol>
    ${GRUPOS.map(g => `<h3 class="dir-h">${g.titulo}</h3><div class="edu-grid">${g.itens.map(card).join("")}</div>`).join("")}
    <h3 class="dir-h">📖 Palavras que aparecem nas leis</h3>
    <div class="card edu"><table class="edu-t">${GLOSSARIO.map(([x, y]) => `<tr><td><b>${x}</b></td><td>${y}</td></tr>`).join("")}</table></div>
    <p class="hint" style="margin-top:10px">Textos escritos por IA (Claude) em outubro de 2026, para orientação geral. Não substituem a consulta a um advogado.</p>`;
}

/* ---------- Radar de leis ---------- */
const ESFERA = { federal: "🏛️ Federal", estadual: "🧉 Estadual (RS)", municipal: "🏘️ Municipal (Lajeado)" };
const ESFERAS = ["federal", "estadual", "municipal"];
// same labels as scripts/leis-categorias.mjs (the collector tags each act with these keys)
const CATEGORIAS = { fazenda: "💰 Fazenda", saude: "🩺 Saúde", nomeacoes: "🪪 Nomeações", comissoes: "👥 Comissões",
  contratos: "📑 Contratos", empresas: "🏢 Empresas", servidores: "🧑‍💼 Servidores", outros: "📌 Outros" };
const AREAS = { fazenda: "💰 Fazenda", saude: "🩺 Saúde", outros: "📌 Outros" };
const PAGINA = 100;   // rows of the full list drawn at a time
const dataBR = s => s ? new Date(s + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }) : "";
const nf1 = v => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v);
const nf0 = v => new Intl.NumberFormat("pt-BR").format(v);
const semAcento = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
let coleta = null, analise = null, filtro = "todos";
// per sphere: highlight area, list category, search text, rows shown, list open
const st = Object.fromEntries(ESFERAS.map(e => [e, { area: "todas", cat: "todos", busca: "", limite: PAGINA, aberto: false }]));

async function carregar() {
  const get = u => fetch(u + "?t=" + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
  [analise, coleta] = await Promise.all([get("relatorios/leis/ultimo.json"), get("relatorios/leis/coleta.json")]);
}
const an = () => analise && (!coleta || analise.data === coleta.data) ? analise : null;
const itensDe = e => (coleta?.itens || []).filter(i => i.esfera === e);
const destDe = e => (an()?.destaques || []).filter(d => d.esfera === e);
const cats = i => i.cats?.length ? i.cats : ["outros"];

// A tax change: before → after and the change in %, red when it goes up, green when it goes down.
function impostoHtml(t) {
  if (!t) return "";
  const v = typeof t.variacao_pct === "number" ? t.variacao_pct : null;
  const cor = v == null ? "var(--muted)" : v > 0 ? "var(--neg)" : v < 0 ? "var(--pos)" : "var(--muted)";
  return `<div class="dir-imp">
      <div class="hint">💰 ${esc(t.tributo || "Imposto")}</div>
      <div class="dir-imp-g"><div><span class="hint">Antes</span><b>${esc(t.antes || "não informado")}</b></div><span class="dir-seta">→</span>
        <div><span class="hint">Agora</span><b>${esc(t.depois || "—")}</b></div>
        ${v != null ? `<div><span class="hint">Variação</span><b style="color:${cor}">${v > 0 ? "+" : ""}${nf1(v)}%</b></div>` : ""}</div>
      ${t.obs ? `<div class="hint">${esc(t.obs)}</div>` : ""}
    </div>`;
}
function cardDestaque(d) {
  return `<article class="card edu">
    <div class="edu-h"><div><h3 style="font-size:16px">${esc(d.titulo)}</h3><div class="hint">${esc(d.orgao || "")}</div></div>
      <span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:end">${d.relevancia === "alta" ? `<span class="mk on">alta</span>` : ""}<span class="mk">${AREAS[d.area] || AREAS.outros}</span></span></div>
    ${impostoHtml(d.imposto)}
    <table class="edu-t" style="margin-top:8px">
      <tr><td>O que muda</td><td>${esc(d.o_que_muda)}</td></tr>
      ${d.quem_afeta ? `<tr><td>Quem é afetado</td><td>${esc(d.quem_afeta)}</td></tr>` : ""}
      ${d.vigencia ? `<tr><td>Vigência</td><td>${esc(d.vigencia)}</td></tr>` : ""}
      ${d.temas?.length ? `<tr><td>Temas</td><td>${d.temas.map(esc).join(", ")}</td></tr>` : ""}
    </table>
    ${d.url ? `<p style="margin-top:8px;font-size:14px">🔗 ${a(esc(d.url), "Ler a norma")}</p>` : ""}
  </article>`;
}
const chips = (attr, e, atual, ops) => `<div class="seg dir-chips" role="group">${ops.map(([k, l, n]) =>
  `<button type="button" ${attr}="${k}" data-esf="${e}" aria-pressed="${k === atual}"${n === 0 && k !== atual ? " disabled" : ""}>${l}${n != null ? ` <span class="dir-n">${nf0(n)}</span>` : ""}</button>`).join("")}</div>`;

// The full list of one sphere, after the category chip and the search box.
function listaHtml(e) {
  const s = st[e], dest = new Set(destDe(e).map(d => d.id)), q = semAcento(s.busca).trim();
  const l = itensDe(e).filter(i => (s.cat === "todos" || (s.cat === "destaques" ? dest.has(i.id) : cats(i).includes(s.cat)))
    && (!q || semAcento(`${i.titulo} ${i.ementa} ${i.orgao} ${i.unidade || ""} ${i.tipo}`).includes(q)));
  if (!l.length) return `<p class="hint" style="padding:10px 0">Nada encontrado com esse filtro.</p>`;
  return `<p class="hint" style="margin:6px 0 0">${nf0(l.length)} ${l.length === 1 ? "publicação" : "publicações"}${l.length > s.limite ? `, mostrando ${nf0(s.limite)}` : ""}</p>
    ${l.slice(0, s.limite).map(i => `
    <div class="dir-it"><span class="hint">${dest.has(i.id) ? "⭐ " : ""}${esc(i.tipo || "")}${i.orgao ? " · " + esc(i.orgao) : ""} · ${cats(i).map(k => CATEGORIAS[k]).join(" ")}${i.lista ? ` · ${esc(i.fonte)}` : ""}</span>
      <div>${i.url ? a(esc(i.url), esc(i.titulo)) : esc(i.titulo)}</div>
      ${i.ementa ? `<div class="hint">${esc(i.ementa)}</div>` : ""}</div>`).join("")}
    ${l.length > s.limite ? `<button type="button" class="btn" data-dmais="${e}" style="margin:10px 0">Mostrar mais ${nf0(Math.min(PAGINA, l.length - s.limite))}</button>` : ""}`;
}
// one block per sphere: its summary, the highlights (by area), then everything published (folded)
function bloco(e) {
  const s = st[e], de = destDe(e), it = itensDe(e), res = an()?.resumo?.[e];
  const dv = de.filter(d => s.area === "todas" || (d.area || "outros") === s.area);
  const destIds = new Set(de.map(d => d.id)), conta = k => it.filter(i => cats(i).includes(k)).length;
  const normas = it.filter(i => !i.lista).length;
  return `<section class="dir-esf" id="dir-s-${e}">
    <h3 class="dir-h">${ESFERA[e]} <span class="hint">· ${nf0(it.length)} publicações${normas !== it.length ? ` (${nf0(normas)} atos normativos)` : ""} · ${de.length} destaques</span></h3>
    ${res ? `<div class="card edu"><p>${esc(res)}</p></div>` : ""}
    ${de.length ? `<h4 class="dir-sub">⭐ Destaques analisados</h4>
      ${chips("data-darea", e, s.area, [["todas", "Todas", de.length], ...Object.entries(AREAS).map(([k, l]) => [k, l, de.filter(d => (d.area || "outros") === k).length])])}
      ${dv.length ? `<div class="edu-grid" style="margin-top:10px">${dv.map(cardDestaque).join("")}</div>` : `<p class="hint">Nenhum destaque nesta área.</p>`}` : ""}
    <details class="dir-tudo" data-desf="${e}"${s.aberto ? " open" : ""}><summary>📋 Tudo o que foi publicado (${nf0(it.length)})</summary>
      ${it.length ? `<div class="card dir-lista">
        ${chips("data-dcat", e, s.cat, [["todos", "Todos", it.length], ["destaques", "⭐ Destaques", destIds.size], ...Object.entries(CATEGORIAS).map(([k, l]) => [k, l, conta(k)])])}
        <input type="search" class="dir-busca" data-dbusca="${e}" value="${esc(s.busca)}" placeholder="Buscar por palavra (ex.: ICMS, Lajeado, enfermagem)" aria-label="Buscar nas publicações">
        <div id="dir-l-${e}">${s.aberto ? listaHtml(e) : ""}</div></div>` : `<p class="hint">Nada publicado nesta esfera neste dia.</p>`}
    </details>
  </section>`;
}
function dirRadar() {
  if (!analise && !coleta) return `<div class="card edu"><p>O radar ainda não rodou. A primeira coleta sai às 21h e a análise chega por e-mail na manhã seguinte.</p></div>`;
  const A = an(), itens = coleta?.itens || [];
  const vis = ESFERAS.filter(e => filtro === "todos" || filtro === e);
  const filtros = `<div class="ftabs dir-f" role="tablist" aria-label="Filtrar por esfera">${["todos", ...ESFERAS].map(f => `<button role="tab" data-dirf="${f}" aria-selected="${f === filtro}">${f === "todos" ? "Todas as esferas" : ESFERA[f]}</button>`).join("")}</div>`;
  return `
    <div class="card edu">
      <div class="edu-h"><div><h3>📡 Publicações de ${esc(dataBR(coleta?.data || A?.data))}</h3>
        <div class="hint">${ESFERAS.map(e => `${ESFERA[e]}: ${nf0(itens.filter(i => i.esfera === e).length)}`).join(" · ")} publicações</div></div></div>
      ${!A ? `<p class="hint" style="margin-top:10px">A análise deste dia ainda não ficou pronta; abaixo, a lista do que foi publicado.</p>` : !A.resumo && A.resumo_geral ? `<p style="margin-top:10px">${esc(A.resumo_geral)}</p>` : ""}
      <p class="hint" style="margin-top:10px"><b>Tudo o que foi publicado</b> = a lista completa do dia, coletada por programa: inclui nomeações, servidores, contratos, licitações e decisões sobre um caso só (uma empresa, um servidor). <b>Destaques</b> = só os atos que mudam regras para a população, empresas ou profissionais; esses a IA lê na íntegra e explica.</p>
      <p class="hint">Filtros: os destaques se dividem em Fazenda, Saúde e Outros; a lista completa, também em Nomeações, Comissões, Contratos, Empresas e Servidores (um ato pode estar em mais de uma). O que vai para o seu e-mail você escolhe em ⚙ Configurações → Radar de leis.</p>
    </div>
    ${filtros}
    ${vis.map(bloco).join("")}
    <p class="hint" style="margin-top:10px">Lista: coletada por programa, sem IA, do Diário Oficial da União (Seção 1 completa; Seções 2 e 3, de pessoal e contratos, só pelo título e começo do texto), do Diário Oficial do RS e do Diário Oficial de Lajeado. As categorias são dadas automaticamente por palavras-chave e podem errar. Análise: resumo automático feito por IA, pode conter erros; confira sempre o texto oficial. Não é orientação jurídica.</p>`;
}

async function render() {
  const box = document.getElementById("dirBox"); if (!box) return;
  if (!box.dataset.feito) { box.dataset.feito = "1"; document.getElementById("dirEdu").innerHTML = dirEducacao(); await carregar(); }
  document.getElementById("dirRadar").innerHTML = dirRadar();
}
const redesenha = e => { const sec = document.getElementById("dir-s-" + e); if (sec) sec.outerHTML = bloco(e); };
document.addEventListener("click", e => {
  const f = e.target.closest("[data-dirf]"); if (f) { filtro = f.dataset.dirf; if (filtro !== "todos") st[filtro].aberto = true; render(); return; }
  const ar = e.target.closest("[data-darea]"); if (ar) { st[ar.dataset.esf].area = ar.dataset.darea; redesenha(ar.dataset.esf); return; }
  const ct = e.target.closest("[data-dcat]"); if (ct) { const s = st[ct.dataset.esf]; s.cat = ct.dataset.dcat; s.limite = PAGINA; redesenha(ct.dataset.esf); return; }
  const m = e.target.closest("[data-dmais]"); if (m) { st[m.dataset.dmais].limite += PAGINA; document.getElementById("dir-l-" + m.dataset.dmais).innerHTML = listaHtml(m.dataset.dmais); return; }
  const s = e.target.closest("[data-dsub]");
  if (s) {
    document.querySelectorAll("[data-dsub]").forEach(b => b.setAttribute("aria-selected", b === s));
    document.querySelectorAll("[data-dsub-panel]").forEach(p => p.hidden = p.dataset.dsubPanel !== s.dataset.dsub);
  }
});
// the list is drawn only when opened (the federal one has thousands of rows)
document.addEventListener("toggle", e => {
  const d = e.target; if (!d.matches?.("[data-desf]")) return;
  const esf = d.dataset.desf; st[esf].aberto = d.open;
  if (d.open) document.getElementById("dir-l-" + esf).innerHTML = listaHtml(esf);
}, true);
let tBusca;
document.addEventListener("input", e => {
  const b = e.target.closest("[data-dbusca]"); if (!b) return;
  const esf = b.dataset.dbusca; st[esf].busca = b.value; st[esf].limite = PAGINA;
  clearTimeout(tBusca); tBusca = setTimeout(() => { document.getElementById("dir-l-" + esf).innerHTML = listaHtml(esf); }, 200);
});
window.renderDireito = render;
// the Education tab may already be on "Direito" when this file loads
if (document.getElementById("dirBox")?.hidden === false) render();
})();
