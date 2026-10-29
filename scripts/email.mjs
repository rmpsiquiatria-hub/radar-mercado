// Turns relatorios/ultimo.json into the daily e-mail and sends it through Gmail.
//   node scripts/email.mjs --preview saida.html   → only writes the HTML (nothing is sent)
//   node scripts/email.mjs                        → sends; needs GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO
// Settings (timeframes, criteria) come from relatorios/config.json.
// The buy/attention rules mirror signal() in index.html — keep both in step.

import { readFile, writeFile } from "node:fs/promises";
import tls from "node:tls";
import { randomBytes } from "node:crypto";

const rel = new URL("../relatorios/", import.meta.url);
const rep = JSON.parse(await readFile(new URL("ultimo.json", rel), "utf8"));
const cfg = JSON.parse(await readFile(new URL("config.json", rel), "utf8"));
const C = cfg.criterios;
// One timeframe for the technical part (the one chosen in the site's Settings, mirrored in config.json).
const TF = cfg.tempo_grafico || (cfg.tempos_graficos || ["diario"])[0];

/* ---------- formatting ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = d => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (v, d = 1) => v == null || !isFinite(v) ? "—" : nf(d).format(v);
const money = (v, cur) => v == null || !isFinite(v) ? "—" : (v < 0 ? "-" : "") + (cur === "USD" ? "US$ " : "R$ ") + nf(2).format(Math.abs(v));
const pct = v => v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : "") + nf(1).format(v) + "%";
const dateBR = (s, o) => new Date(s + "T12:00:00").toLocaleDateString("pt-BR", o);
const GREEN = "#0a8a4a", RED = "#c9302c", AMBER = "#b26b00", MUTED = "#5d6b76", LINE = "#e3e8ec";
const color = s => s === "alta" ? GREEN : s === "baixa" ? RED : MUTED;
const arrow = s => s === "alta" ? "▲" : s === "baixa" ? "▼" : "■";
const FRAME_LABEL = { diario: "Diário", semanal: "Semanal", mensal: "Mensal" };

/* ---------- same rules as the site ---------- */
function criteriaFails(e) {
  const i = e.indicadores; if (!i) return null;
  const f = [];
  if (C.pl_max != null && !(i.pl > 0 && i.pl <= C.pl_max)) f.push(i.pl > 0 ? `P/L ${num(i.pl)} acima de ${C.pl_max}` : "P/L negativo");
  if (C.dy_min != null && !(i.dy >= C.dy_min)) f.push(`dividendos ${num(i.dy ?? 0)}% abaixo de ${C.dy_min}%`);
  if (C.roe_min != null && !(i.roe >= C.roe_min)) f.push(`ROE ${num(i.roe ?? 0)}% abaixo de ${C.roe_min}%`);
  if (C.div_max != null && i.div_liq_pl != null && i.div_liq_pl > C.div_max) f.push(`dívida líq./patrim. ${num(i.div_liq_pl, 2)}`);
  return f;
}
function signal(e) {
  const k = e.consenso || {}, tot = (k.compra || 0) + (k.neutro || 0) + (k.venda || 0);
  const fails = criteriaFails(e), enough = tot >= (C.min_casas || 1);
  const down = (e.mudancas || []).find(m => m.tipo === "rebaixamento"), up = (e.mudancas || []).find(m => m.tipo === "elevacao");
  const att = [];
  if (enough && k.venda / tot >= 0.4) att.push(`${k.venda} de ${tot} casas recomendam venda`);
  if (down) att.push("rebaixamento recente: " + down.descricao);
  if (e.sentimento === "negativo" && fails && fails.length) att.push("notícias negativas e não passa nos critérios");
  if (att.length) return { kind: "atencao", why: att };
  if (enough && k.compra / tot >= 0.6 && (!fails || !fails.length)) {
    const why = [`${k.compra} de ${tot} casas recomendam compra`, fails ? "passa nos critérios" : "sem indicadores para checar critérios"];
    if (up) why.push("elevação recente: " + up.descricao);
    return { kind: "compra", why };
  }
  return null;
}
const price = e => e.indicadores?.cotacao ?? e.tecnica?.diario?.fechamento ?? null;
const cur = e => e.bolsa === "B3" ? "BRL" : "USD";
const upside = e => { const a = e.consenso?.preco_alvo_medio, p = price(e); return a && p ? (a / p - 1) * 100 : null; };
function techEvents(e, f) {
  const t = e.tecnica?.[f]; if (!t) return [];
  const rank = n => /Golden|Death/.test(n) ? 3 : /MME 9/.test(n) ? 1 : 0;
  return [...t.cruzamentos.filter(c => !/MACD/.test(c.nome)).map(c => ({ sinal: c.sinal, texto: c.nome.replace(/ \(.*\)/, "") + " para " + c.sinal, peso: rank(c.nome) })),
          ...t.candles.filter(c => c.sinal !== "neutro").map(c => ({ sinal: c.sinal, texto: "candle " + c.nome, peso: 2 }))]
    .sort((a, b) => b.peso - a.peso);
}

/* ---------- e-mail body ---------- */
const emps = rep.empresas;
const sig = emps.map(e => [e, signal(e)]);
const buys = sig.filter(([, s]) => s?.kind === "compra"), warns = sig.filter(([, s]) => s?.kind === "atencao");
// Both analyses on the same side (mirrors convergence() in index.html): buy signal + technical
// bias "alta" on TF, or attention + technical bias "baixa".
const convBuy = buys.filter(([e]) => e.tecnica?.[TF]?.vies === "alta");
const convSell = warns.filter(([e]) => e.tecnica?.[TF]?.vies === "baixa");
const staleResearch = rep.pesquisa_data && rep.pesquisa_data !== rep.data;
const h2 = t => `<h2 style="font-size:17px;margin:26px 0 8px;padding-bottom:6px;border-bottom:2px solid ${LINE}">${t}</h2>`;
const hint = t => `<p style="margin:0 0 8px;color:${MUTED};font-size:13px">${t}</p>`;
const link = (e) => `<a href="${esc(cfg.site)}" style="color:#0f766e;text-decoration:none;font-weight:700">${esc(e.ticker)}</a>`;

// A short "why" for each signal, built only from the report's own data: which houses said what
// (with their targets), how the company fares on the user's criteria, and the first sentence of
// the AI summary of the news.
const lista = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " e " + a.at(-1);
// (a period right after a lone capital, as in "J.P. Morgan", does not end the sentence)
const firstSentence = t => (String(t || "").match(/^.+?(?<!\b[A-Z])[.!?](?=\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]|$)/s) || [""])[0].trim();
function justify(e, kind) {
  const k = e.consenso || {}, moeda = k.moeda || cur(e), out = [];
  const lado = kind === "compra" ? "compra" : "venda";
  const casas = (k.casas || []).filter(c => c.recomendacao === lado).map(c => esc(c.nome) + (c.preco_alvo ? ` (alvo ${money(c.preco_alvo, moeda)})` : ""));
  if (casas.length) out.push(`Recomenda${casas.length > 1 ? "m" : ""} ${lado}: ${lista(casas)}.`);
  const i = e.indicadores, fails = criteriaFails(e);
  if (kind === "compra" && i) out.push(`Dentro dos seus critérios: P/L ${num(i.pl)} (máx. ${C.pl_max}), dividendos ${num(i.dy)}% (mín. ${C.dy_min}%), ROE ${num(i.roe)}% (mín. ${C.roe_min}%).`);
  if (kind !== "compra" && fails?.length) out.push(`Fora dos seus critérios: ${esc(lista(fails))}.`);
  const ctx = firstSentence(e.resumo);
  if (ctx) out.push(`Notícias: ${esc(ctx)}`);
  return out.join(" ");
}
function signalRows(list, kind) {
  if (!list.length) return hint("Nenhum papel hoje.");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${list.map(([e, s]) => `
    <tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};vertical-align:top;width:70px">${link(e)}</td>
      <td style="padding:8px 0 8px 8px;border-bottom:1px solid ${LINE}"><b>${esc(e.nome)}</b>
        <div style="font-size:13px">Cotação de ontem: <b>${money(price(e), cur(e))}</b>${e.consenso?.preco_alvo_medio ? ` · preço-alvo médio das casas: <b>${money(e.consenso.preco_alvo_medio, e.consenso.moeda || cur(e))}</b> (<span style="color:${upside(e) >= 0 ? GREEN : RED}">${upside(e) >= 0 ? "potencial de alta" : "abaixo do preço atual"}: ${pct(upside(e))}</span>)` : ""}</div>
        <div style="color:${kind === "compra" ? GREEN : AMBER};font-size:13px;font-weight:700;margin-top:3px">${esc(s.why.join(" · "))}</div>
        <div style="color:#33414b;font-size:13px;margin-top:3px;line-height:1.45"><b>Por quê:</b> ${justify(e, kind)}</div></td></tr>`).join("")}</table>`;
}

// Each company goes to the side its signals point to (weighted: golden/death cross > candles > short
// averages); buy alerts are listed first, then sell alerts, then the few that point both ways.
const techLado = x => { const n = x.reduce((a, t) => a + (t.sinal === "alta" ? 1 : t.sinal === "baixa" ? -1 : 0) * (t.peso + 1), 0); return n > 0 ? "alta" : n < 0 ? "baixa" : "misto"; };
function techSection(f) {
  const ev = emps.map(e => [e, techEvents(e, f)]).filter(([, x]) => x.length).sort((a, b) => b[1][0].peso - a[1][0].peso);
  const grupos = [["alta", "▲ Alerta de compra", GREEN], ["baixa", "▼ Alerta de venda", RED], ["misto", "◆ Sinais nos dois sentidos", MUTED]]
    .map(([lado, titulo, cor]) => ({ titulo, cor, lista: ev.filter(([, x]) => techLado(x) === lado).map(([e, x]) => [e, x.slice().sort((a, b) => (b.sinal === lado) - (a.sinal === lado) || b.peso - a.peso)]) }))
    .filter(g => g.lista.length);
  const tabela = lista => `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">${lista.slice(0, 20).map(([e, x]) => `
      <tr><td style="padding:5px 0;border-bottom:1px solid ${LINE};width:70px;vertical-align:top">${link(e)}</td>
        <td style="padding:5px 0 5px 8px;border-bottom:1px solid ${LINE}">${x.map(t => `<span style="color:${color(t.sinal)}">${arrow(t.sinal)} ${esc(t.texto)}</span>`).join("<br>")}</td></tr>`).join("")}</table>
      ${lista.length > 20 ? hint(`…e mais ${lista.length - 20} no site.`) : ""}`;
  const bias = { alta: 0, baixa: 0, neutro: 0 };
  emps.forEach(e => { const v = e.tecnica?.[f]?.vies; if (v) bias[v]++; });
  const when = { diario: "último pregão", semanal: "última semana fechada", mensal: "último mês fechado" }[f];
  return `<h3 style="font-size:15px;margin:16px 0 4px">Empresas com sinais técnicos no gráfico ${FRAME_LABEL[f].toLowerCase()} (${ev.length}) <span style="font-weight:400;color:${MUTED};font-size:13px">· ${when}</span></h3>
    ${hint(`Tendência geral das ${emps.length} empresas acompanhadas neste gráfico: <b style="color:${GREEN}">${bias.alta} de alta</b>, <b style="color:${RED}">${bias.baixa} de baixa</b>, ${bias.neutro} neutras.`)}
    ${ev.length ? grupos.map(g => `<div style="font-size:14px;font-weight:700;color:${g.cor};margin:12px 0 2px">${g.titulo} (${g.lista.length})</div>${tabela(g.lista)}`).join("") : hint("Nenhuma empresa com cruzamento de médias ou candle de reversão recente neste gráfico.")}`;
}

function convRows(list, kind) {
  if (!list.length) return hint("Nenhum ativo hoje.");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${list.map(([e, s]) => { const t = e.tecnica[TF], ev = techEvents(e, TF); return `
    <tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};vertical-align:top;width:70px">${link(e)}</td>
      <td style="padding:8px 0 8px 8px;border-bottom:1px solid ${LINE}"><b>${esc(e.nome)}</b> · ${money(price(e), cur(e))}
        <div style="font-size:13px"><span style="color:#0f766e">📊 ${esc(s.why[0])}</span><br><span style="color:#6d28d9">📈 tendência ${esc(t.tendencia)}${ev.length ? " · " + esc(ev.map(x => x.texto).join(" · ")) : ""}</span></div></td></tr>`; }).join("")}</table>`;
}

function changesSection() {
  const all = emps.flatMap(e => (e.mudancas || []).map(m => [e, m])).sort((a, b) => b[1].data.localeCompare(a[1].data));
  if (!all.length) return hint("Nenhuma mudança relevante noticiada nos últimos 7 dias.");
  return `<ul style="margin:0;padding-left:18px;font-size:14px">${all.map(([e, m]) => `<li style="margin:4px 0">${link(e)} — ${esc(m.descricao)} <span style="color:${MUTED}">(${esc(m.fonte)}, ${dateBR(m.data, { day: "2-digit", month: "2-digit" })})</span></li>`).join("")}</ul>`;
}

function overviewTable() {
  // Only the assets where both analyses point the same way: buy side first, then sell side.
  const rows = [...convBuy, ...convSell].map(([e]) => e);
  if (!rows.length) return hint("Hoje nenhum ativo tem a análise fundamentalista e a técnica apontando para o mesmo lado.");
  const th = t => `<th style="text-align:right;padding:5px 3px;font-size:10px;color:${MUTED};border-bottom:2px solid ${LINE};white-space:nowrap">${t}</th>`;
  const td = (t, extra = "") => `<td style="text-align:right;padding:5px 3px;border-bottom:1px solid ${LINE};white-space:nowrap;${extra}">${t}</td>`;
  const tech = e => { const v = e.tecnica?.[TF]?.vies; return v ? `<span style="color:${color(v)}">${arrow(v)} ${v}</span>` : "·"; };
  return `<div style="overflow-x:auto"><table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;width:100%">
    <tr><th></th><th></th><th colspan="4" style="font-size:10px;padding:4px 3px;background:#e0f2ef;color:#0f766e;text-transform:uppercase;letter-spacing:.04em">📊 Fundamentalista</th><th style="font-size:10px;padding:4px 3px;background:#ede9fe;color:#6d28d9;text-transform:uppercase;letter-spacing:.04em">📈 Técnica</th></tr>
    <tr><th style="text-align:left;padding:6px 4px;font-size:11px;color:${MUTED};border-bottom:2px solid ${LINE}">Ativo</th>${th("Preço")}${th("C·N·V")}${th("Pot.")}${th("P/L")}${th("Div.")}${th(FRAME_LABEL[TF])}</tr>
    ${rows.map(e => { const k = e.consenso || {}; return `<tr><td style="padding:6px 4px;border-bottom:1px solid ${LINE}">${link(e)}${e.origem?.includes("lista pessoal") ? " ★" : ""}</td>
      ${td(money(price(e), cur(e)))}${td(`${k.compra || 0}·${k.neutro || 0}·${k.venda || 0}`)}${td(pct(upside(e)), `color:${upside(e) >= 0 ? GREEN : RED}`)}${td(num(e.indicadores?.pl))}${td(e.indicadores?.dy != null ? num(e.indicadores.dy) + "%" : "—")}${td(tech(e))}</tr>`; }).join("")}
  </table></div>${hint(`★ sua lista · <b>Fundamentalista</b>: C·N·V = quantas casas recomendam compra, neutro e venda; Pot. = potencial até o preço-alvo médio; P/L e dividendos. <b>Técnica</b>: tendência no gráfico ${FRAME_LABEL[TF].toLowerCase()} (▲ alta, ▼ baixa, ■ neutro).`)}`;
}

const dayLong = dateBR(rep.data, { weekday: "long", day: "2-digit", month: "long" });
const subject = `Radar do Mercado · ${dateBR(rep.data, { day: "2-digit", month: "2-digit" })} · ${buys.length} sinais de compra, ${warns.length} de atenção`;
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8">
<div style="max-width:680px;margin:0 auto;padding:20px 16px;font-family:Arial,Helvetica,sans-serif;color:#0f1b24;line-height:1.5;background:#ffffff">
  <div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;font-weight:700">Radar do Mercado</div>
  <h1 style="font-size:22px;margin:4px 0 2px">Relatório de ${esc(dayLong)}</h1>
  ${hint(`${emps.length} empresas · Ibovespa + sua lista · análise técnica no gráfico ${FRAME_LABEL[TF].toLowerCase()}`)}
  ${staleResearch ? `<p style="background:#fff3dc;color:${AMBER};padding:10px 12px;border-radius:8px;font-size:14px"><b>Atenção:</b> a pesquisa de notícias de hoje não rodou; recomendações e notícias são de ${dateBR(rep.pesquisa_data)}. Preços, indicadores e análise técnica estão atualizados.</p>` : ""}
  ${h2("🌎 Resumo do mercado")}
  <p style="font-size:15px;margin:0 0 14px">${esc(rep.resumo_mercado)}</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 8px;font-size:14px;margin-top:6px">
    <tr><td style="background:#f4f6f8;border-radius:8px;padding:12px 14px">
      <b style="font-size:15px">Como ler este e-mail: duas formas diferentes de analisar uma ação</b>
    </td></tr>
    <tr><td style="background:#e0f2ef;border-left:4px solid #0f766e;border-radius:8px;padding:12px 14px">
      <b style="color:#0f766e">📊 Análise fundamentalista (Parte 1)</b><br>
      Olha para a <b>empresa</b>: lucro, dívida, dividendos, quanto o preço da ação representa em relação ao que a empresa ganha, e o que as casas de análise (bancos e corretoras) recomendam.
      Responde à pergunta <i>"esta empresa é boa e está barata?"</i>. Pensa em <b>meses a anos</b>.
    </td></tr>
    <tr><td style="background:#ede9fe;border-left:4px solid #6d28d9;border-radius:8px;padding:12px 14px">
      <b style="color:#6d28d9">📈 Análise técnica (Parte 2)</b><br>
      Olha só para o <b>gráfico de preços</b>: tendência, médias móveis, candles, suporte e resistência. Não diz se a empresa é boa —
      diz <i>"como o preço está se comportando agora?"</i> e ajuda a escolher o <b>momento</b> de entrar ou sair. Pensa em <b>dias a semanas</b>${TF === "semanal" ? " (no gráfico semanal, semanas a meses)" : TF === "mensal" ? " (no gráfico mensal, meses)" : ""}.
    </td></tr>
    <tr><td style="font-size:13px;color:${MUTED};padding:0 4px">As duas se complementam: uma empresa pode ser boa (fundamentalista positiva) e o preço ainda estar caindo (técnica negativa), ou o contrário. A <b>Parte 3</b> mostra só os ativos em que as duas apontam para o mesmo lado.</td></tr>
  </table>

  <div style="margin:26px 0 0;padding:10px 14px;border-radius:8px;background:#0f766e;color:#ffffff;font-weight:700;font-size:16px">📊 PARTE 1 · ANÁLISE FUNDAMENTALISTA</div>
  ${hint("Baseada nas recomendações publicadas pelas casas de análise (resumidas por IA, com links no site) e nos indicadores das empresas (Fundamentus).")}

  ${h2(`🟢 Sinais de compra (${buys.length})`)}
  ${hint(`A maioria das casas consultadas (mínimo ${C.min_casas}) recomenda compra <b>e</b> o papel passa nos critérios: P/L ≤ ${C.pl_max}, dividendos ≥ ${C.dy_min}%, ROE ≥ ${C.roe_min}%, dívida líq./patrimônio ≤ ${C.div_max}.`)}
  ${signalRows(buys, "compra")}

  ${h2(`🟠 Pontos de atenção (${warns.length})`)}
  ${hint("Recomendações de venda, rebaixamentos recentes ou notícias negativas com indicadores fracos.")}
  ${signalRows(warns, "atencao")}

  ${h2("📰 Mudanças recentes nas recomendações (7 dias)")}
  ${changesSection()}

  <div style="margin:30px 0 0;padding:10px 14px;border-radius:8px;background:#6d28d9;color:#ffffff;font-weight:700;font-size:16px">📈 PARTE 2 · ANÁLISE TÉCNICA · gráfico ${FRAME_LABEL[TF].toLowerCase()}</div>
  ${hint(`Calculada por programa a partir dos preços, sem IA. Sinais considerados: cruzamento das médias curtas (MME 9 × MMS 21), golden/death cross (MMS 50 × MMS 200) e candles de reversão. Cada candle deste gráfico representa ${{ diario: "um dia de negociação", semanal: "uma semana de negociação", mensal: "um mês de negociação" }[TF]}. O gráfico é o escolhido em Configurações no site.`)}
  ${techSection(TF)}

  <div style="margin:30px 0 0;padding:10px 14px;border-radius:8px;background:#b45309;color:#ffffff;font-weight:700;font-size:16px">🎯 PARTE 3 · ONDE AS DUAS ANÁLISES CONCORDAM</div>
  ${hint(`Só os ativos em que a análise fundamentalista e a técnica (gráfico ${FRAME_LABEL[TF].toLowerCase()}) apontam para o <b>mesmo lado</b>: sinal de compra com tendência de alta, ou ponto de atenção com tendência de baixa.`)}
  ${h2(`▲ Para o lado da compra (${convBuy.length})`)}
  ${convRows(convBuy)}
  ${h2(`▼ Para o lado da venda (${convSell.length})`)}
  ${convRows(convSell)}
  ${hint("Concordância não é garantia: as duas análises podem errar juntas.")}

  ${h2("📋 Anexo: onde as duas análises concordam, lado a lado")}
  ${overviewTable()}

  <p style="margin:28px 0 8px"><a href="${esc(cfg.site)}" style="display:inline-block;background:#0f766e;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Abrir o painel completo</a></p>
  <p style="font-size:12px;color:#8c99a3;margin-top:24px">Resumo automático do que fontes publicadas dizem, feito por IA (pode conter erros — confira os links no site). Indicadores: Fundamentus. Cotações e candles: Yahoo Finance. Análise técnica calculada por programa, sem IA. Não é recomendação de investimento.</p>
</div></body></html>`;

const text = [
  `Radar do Mercado — relatório de ${dayLong}`, "", rep.resumo_mercado, "",
  `Sinais de compra (${buys.length}): ${buys.map(([e]) => e.ticker).join(", ") || "nenhum"}`,
  `Pontos de atenção (${warns.length}): ${warns.map(([e]) => e.ticker).join(", ") || "nenhum"}`, "",
  `As duas análises concordam — compra: ${convBuy.map(([e]) => e.ticker).join(", ") || "nenhum"}; venda: ${convSell.map(([e]) => e.ticker).join(", ") || "nenhum"}`, "",
  `Painel completo: ${cfg.site}`,
].join("\n");

/* ---------- output ---------- */
const args = process.argv.slice(2);
if (args[0] === "--preview") {
  await writeFile(args[1] || "email-preview.html", html);
  console.log(`Prévia gravada em ${args[1] || "email-preview.html"} — assunto: ${subject}`);
} else {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !EMAIL_TO) { console.error("Faltam GMAIL_USER, GMAIL_APP_PASSWORD ou EMAIL_TO."); process.exit(1); }
  await sendGmail({ user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s/g, ""), to: EMAIL_TO, subject, html, text });
  console.log(`E-mail enviado — ${subject}`);
}

/* ---------- minimal SMTP client for Gmail (implicit TLS, port 465) ---------- */
async function sendGmail({ user, pass, to, subject, html, text }) {
  const b64 = s => Buffer.from(s, "utf8").toString("base64");
  const wrap = s => s.match(/.{1,76}/g).join("\r\n");
  const boundary = "radar-" + randomBytes(8).toString("hex");
  const message = [
    `From: Radar do Mercado <${user}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${Date.now()}.${randomBytes(6).toString("hex")}@radar-mercado>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(text)),
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(html)),
    `--${boundary}--`, "",
  ].join("\r\n");

  const sock = tls.connect({ host: "smtp.gmail.com", port: 465, servername: "smtp.gmail.com" });
  sock.setEncoding("utf8");
  let buf = "", failed = null;
  const waiters = [];
  const flush = () => {
    while (waiters.length) {
      const m = buf.match(/^(?:\d{3}-[^\r\n]*\r\n)*(\d{3})(?: [^\r\n]*)?\r\n/);
      if (!m) return;
      buf = buf.slice(m[0].length);
      waiters.shift().resolve({ code: +m[1], text: m[0].trim() });
    }
  };
  sock.on("data", d => { buf += d; flush(); });
  sock.on("error", err => { failed = err; waiters.splice(0).forEach(w => w.reject(err)); });
  const reply = () => new Promise((resolve, reject) => { if (failed) return reject(failed); waiters.push({ resolve, reject }); flush(); });
  // `label` names the step in errors so credentials never end up in a log.
  const step = async (line, ok, label) => {
    if (line != null) sock.write(line + "\r\n");
    const r = await reply();
    if (!ok.includes(r.code)) throw new Error(`SMTP ${label} recusado: ${r.text.replace(/\s+/g, " ").slice(0, 200)}`);
  };
  await new Promise((res, rej) => { sock.once("secureConnect", res); sock.once("error", rej); });
  try {
    await step(null, [220], "conexão");
    await step("EHLO radar-mercado", [250], "EHLO");
    await step("AUTH LOGIN", [334], "AUTH");
    await step(b64(user), [334], "usuário");
    await step(b64(pass), [235], "senha de app");
    await step(`MAIL FROM:<${user}>`, [250], "remetente");
    await step(`RCPT TO:<${to}>`, [250, 251], "destinatário");
    await step("DATA", [354], "DATA");
    await step(message + "\r\n.", [250], "envio");
    await step("QUIT", [221], "QUIT").catch(() => {});
  } finally { sock.end(); }
}
