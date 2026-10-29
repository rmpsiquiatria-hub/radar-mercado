// Categories of each collected act, for the filters on the site (Educação → Direito) and the e-mail
// preferences. An act can be in more than one: a subject (fazenda, saude) and a kind (nomeacoes,
// comissoes, contratos, empresas, servidores). "outros" = none of them. Plain keyword rules over
// type, agency, title and the start of the text; they miss now and then, the filters say so.

export const CATEGORIAS = {
  fazenda: "💰 Fazenda", saude: "🩺 Saúde", nomeacoes: "🪪 Nomeações", comissoes: "👥 Comissões",
  contratos: "📑 Contratos", empresas: "🏢 Empresas", servidores: "🧑‍💼 Servidores", outros: "📌 Outros",
};
// The highlights only split by subject.
export const AREAS = { fazenda: "💰 Fazenda", saude: "🩺 Saúde", outros: "📌 Outros" };

const ORG_FAZENDA = /fazenda|receita (federal|estadual)|tesouro|minist[ée]rio da economia|planejamento e or[çc]amento|confaz|sefaz|contadoria|tributa|procuradoria-geral da fazenda|banco central|conselho monet[áa]rio|comiss[ãa]o de valores mobili/i;
const TXT_FAZENDA = /\b(icms|ipva|itcmd|itbi|iptu|issqn?|irpf|irpj|ipi|iof|cofins|pis\/pasep|csll|simples nacional|imposto|tribut|al[íi]quota|contribui[çc][ãa]o (social|previdenci)|parcelamento de d[ée]bito|d[íi]vida ativa|substitui[çc][ãa]o tribut|benef[íi]cio fiscal|incentivo fiscal|isen[çc][ãa]o|cr[ée]dito (suplementar|especial|extraordin)|or[çc]ament|taxa de fiscaliza)/i;
const ORG_SAUDE = /sa[úu]de|anvisa|\bans\b|vigil[âa]ncia sanit|hospital|fiocruz|ebserh|hemocentro|conselho (federal|regional) de (medicina|enfermagem|farm[áa]cia|odontologia|psicologia|nutri|fisioterapia)|\bses\b|\bsus\b|funasa|anvisa/i;
const TXT_SAUDE = /\b(sa[úu]de|sus|medicament|f[áa]rmac|hospital|vacina|sanit[áa]ri|m[ée]dic|enfermag|epidemi|doen[çc]a|cl[íi]nica|ambulat|leitos?|aten[çc][ãa]o b[áa]sica|cnes)\b/i;
const NOMEACAO = /\b(nomea[rç]|nomeia|nomeados?\b|exonera|designa[rç]?\b|designa[çc][ãa]o|designad[oa]s?\b|dispensa[rd]?\b.{0,40}(cargo|fun[çc][ãa]o)|cargo em comiss[ãa]o|fun[çc][ãa]o (comissionada|gratificada)|substitut[oa] eventual)/i;
// creating a committee or naming its members (not just an agency called "Comissão de ...")
const COMISSAO = /\b(institu|cri[ao]|constitu|designa|comp[õo]e|composi[çc]|nomeia|integra[rm]|membros?|recomp)[^.;]{0,90}\b(comiss[ãa]o|comiss[õo]es|comit[êe]s?|grupo de trabalho|grupo t[ée]cnico|for[çc]a-tarefa|banca examinadora|c[âa]mara t[ée]cnica|conselho|f[óo]rum|n[úu]cleo)\b|^(comiss|comit)/i;
const CONTRATO = /\b(contrat(o|a[çc][ãa]o)|licita|preg[ãa]o|concorr[êe]ncia|tomada de pre[çc]os|termo aditivo|aditivo|apostilamento|extrato|conv[êe]nio|ata de registro|homologa|adjudica|dispensa de licita|inexigibilidade|chamamento p[úu]blico|termo de (fomento|colabora|doa[çc]|cess[ãa]o)|doa[çc][ãa]o|credenciamento)/i;
const EMPRESA = /\b(ltda|s\.\s?a\.|s\/a|eireli|\bme\b|\bepp\b|cnpj|empresa|companhia|cooperativa|registro de (produto|empresa)|autoriza[çc][ãa]o de funcionamento|outorga|concess[ãa]o|permiss[ãa]o de servi|cancelamento de registro|habilita[çc][ãa]o|licen[çc]a (de opera|ambiental|pr[ée]via|de instala)|ato declarat[óo]rio executivo)\b/i;
const SERVIDOR = /\b(servidor|servidora|servidores|aposentad|aposentar|pens[ãa]o|f[ée]rias|licen[çc]a (para|por|sa[úu]de|pr[êe]mio|maternidade|capacita)|progress[ãa]o|promo[çc][ãa]o funcional|remo[çc][ãa]o|redistribui|cess[ãa]o de servidor|vac[âa]ncia|lota[çc][ãa]o|lotar|gratifica[çc]|abono|matr[íi]cula|readapta|averba|recursos humanos|atos de pessoal|posse|exerc[íi]cio provis|est[áa]gio probat)/i;

export function categorias(i) {
  const tipo = `${i.tipo || ""}`, org = `${i.orgao || ""} ${i.unidade || ""}`;
  // the preamble "O PRESIDENTE ..., nomeado pela Portaria ..." is not a nomination
  const txt = `${i.titulo || ""} ${i.ementa || ""}`.replace(/(nomead|designad)[oa]s? (pel[oa]|por meio|atrav[ée]s)/gi, "");
  // "cargo em comissão" is a nomination, not a committee
  const semCargo = txt.replace(/(cargo|fun[çc][ãa]o)s? (em )?comiss(ão|ao|ionad[ao])/gi, "");
  const c = [];
  if (ORG_FAZENDA.test(org) || TXT_FAZENDA.test(txt)) c.push("fazenda");
  if (ORG_SAUDE.test(org) || TXT_SAUDE.test(txt)) c.push("saude");
  if (NOMEACAO.test(txt)) c.push("nomeacoes");
  if (COMISSAO.test(semCargo)) c.push("comissoes");
  if (CONTRATO.test(tipo) || /^(extrato|aviso de licita|edital de licita|termo aditivo)/i.test(i.titulo || "") || /licita|contrat|conv[êe]ni/i.test(tipo)) c.push("contratos");
  else if (CONTRATO.test(txt) && !/^(lei|decreto|medida provis|instru[çc][ãa]o normativa|resolu)/i.test(i.titulo || "")) c.push("contratos");
  if (EMPRESA.test(txt) && !/^(lei|decreto|medida provis)/i.test(i.titulo || "")) c.push("empresas");
  if (/recursos humanos|atos de pessoal|previdenci/i.test(tipo) || (SERVIDOR.test(txt) && !c.includes("nomeacoes"))) c.push("servidores");
  return c.length ? c : ["outros"];
}

// A highlight's subject: the analysis may say it (area); otherwise a tax block, then the themes the
// analysis gave, and only without themes the act's own categories.
export function areaDestaque(d, item) {
  if (AREAS[d.area]) return d.area;
  if (d.imposto) return "fazenda";
  const temas = (d.temas || []).join(" ");
  if (temas) return /tribut|fiscal|imposto|fazend|or[çc]ament|contas p[úu]blicas/i.test(temas) ? "fazenda" : /sa[úu]de|sus\b|medic|hospital|vacina/i.test(temas) ? "saude" : "outros";
  const cats = item?.cats || [];
  return cats.includes("fazenda") ? "fazenda" : cats.includes("saude") ? "saude" : "outros";
}
