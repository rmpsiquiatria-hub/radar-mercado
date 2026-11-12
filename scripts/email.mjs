// Turns relatorios/ultimo.json into the daily e-mail and sends it through Gmail.
//   node scripts/email.mjs --preview saida.html   → only writes the HTML (nothing is sent)
//   node scripts/email.mjs                        → sends; needs GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO
//   --semanal (with or without --preview)         → the Saturday e-mail: technical analysis of the week only
// Settings (timeframes, criteria) come from relatorios/config.json.
// The buy/attention rules mirror signal() in index.html — keep both in step.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { sendGmail } from "./gmail.mjs";

const rel = new URL("../relatorios/", import.meta.url);
const rep = JSON.parse(await readFile(new URL("ultimo.json", rel), "utf8"));
const cfg = JSON.parse(await readFile(new URL("config.json", rel), "utf8"));
// One line on what each company does (relatorios/descricoes.json, kept by hand).
const DESC = await readFile(new URL("descricoes.json", rel), "utf8").then(JSON.parse).catch(() => ({}));
// The previous report (the latest file in historico/ dated before this one), to show only what changed.
const prevRep = await (async () => {
  const dias = (await readdir(new URL("historico/", rel)).catch(() => [])).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).filter(d => d < rep.data).sort();
  return dias.length ? JSON.parse(await readFile(new URL(`historico/${dias.at(-1)}.json`, rel), "utf8")) : null;
})();
const C = cfg.criterios;
const args = process.argv.slice(2);
// Weekday e-mail: technical analysis on the daily chart. Saturday e-mail: the weekly chart (the week
// that closed on Friday).
const WEEKLY = args.includes("--semanal");
const TF = WEEKLY ? "semanal" : "diario";

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
// Part 1 lists only what changed since the previous report: new signals, or a company that switched side.
// The signal of the day before is recomputed from that report with today's criteria.
const prevKind = new Map((prevRep?.empresas || []).map(e => [e.ticker, signal(e)?.kind || null]));
const mudou = ([e, s]) => !prevRep || prevKind.get(e.ticker) !== s.kind;
const buysNew = buys.filter(mudou), warnsNew = warns.filter(mudou);
const KIND_TXT = { compra: "sinal de compra", atencao: "ponto de atenção" };
const antes = e => !prevRep ? "" : !prevKind.has(e.ticker) ? "nova no relatório" : prevKind.get(e.ticker) ? `antes: ${KIND_TXT[prevKind.get(e.ticker)]}` : "novo sinal";
// Signals that disappeared since the previous report (a switch of side is already in the lists above).
const sairam = prevRep ? (prevRep.empresas || []).filter(p => prevKind.get(p.ticker) && !sig.some(([e, s]) => e.ticker === p.ticker && s)) : [];
// Every fundamental recommendation stays on the site (tab Empresas, filter "Com sinal").
const siteSinais = cfg.site.replace(/\/?$/, "/") + "#empresas/sinais";
// A company whose recent technical signals point both ways (a buy and a sell alert on the same chart)
// is left out of every technical list: the signals cancel each other.
const conflito = (e, f) => { const x = techEvents(e, f); return x.some(t => t.sinal === "alta") && x.some(t => t.sinal === "baixa"); };
// Side the chart points to (mirrors techSide() in index.html): a recent buy or sell alert wins; with none,
// the trend bias; nothing when the alerts point both ways.
const ladoTec = (e, f) => { if (conflito(e, f)) return null; const x = techEvents(e, f); return x.length ? x[0].sinal : e.tecnica?.[f]?.vies; };
// Part 3 uses every fundamental signal on file, changed today or not: buy signal + chart on the buy side,
// or attention + chart on the sell side.
const convBuy = buys.filter(([e]) => ladoTec(e, TF) === "alta");
const convSell = warns.filter(([e]) => ladoTec(e, TF) === "baixa");
const staleResearch = rep.pesquisa_data && rep.pesquisa_data !== rep.data;

// Which period each analysis looks at, written out so the reader does not have to guess.
// The technical candle is the most common last closed candle among the companies; weekly
// candles are stamped on the Monday and close on Friday.
const lastCandle = (() => {
  const n = {}; for (const e of emps) { const d = e.tecnica?.[TF]?.data_ultimo_candle; if (d) n[d] = (n[d] || 0) + 1; }
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
})();
const ddmm = d => d.split("-").reverse().slice(0, 2).join("/");
const techPeriod = !lastCandle ? "último candle fechado"
  : TF === "diario" ? `pregão de ${ddmm(lastCandle)}`
  : TF === "semanal" ? (() => { const f = new Date(lastCandle + "T12:00:00"); f.setDate(f.getDate() + 4); return `semana de ${ddmm(lastCandle)} a ${ddmm(f.toLocaleDateString("sv-SE"))}`; })()
  : `mês de ${dateBR(lastCandle, { month: "long", year: "numeric" })}`;
const techDa = (TF === "semanal" ? "da " : "do ") + techPeriod;   // "do pregão de 03/11", "da semana de …"
const researchDay = dateBR(rep.pesquisa_data || rep.data, { day: "2-digit", month: "2-digit" });
// The research runs before the market opens, so in practice the whole e-mail reflects the previous session.
const closeDay = TF === "diario" && lastCandle ? ddmm(lastCandle) : null;
const datesBox = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin:10px 0 0;background:#f4f6f8;border-radius:8px">
    <tr><td colspan="2" style="padding:10px 14px 4px"><b>📅 Que período cada análise usa</b></td></tr>
    ${closeDay ? `<tr><td colspan="2" style="padding:0 14px 6px">Em resumo: este e-mail mostra o mercado <b>como ele fechou em ${closeDay}</b>. Ele é montado entre 6h e 7h15, antes da abertura da bolsa, então nada do pregão de hoje entra aqui.</td></tr>` : ""}
    <tr><td style="padding:3px 14px;vertical-align:top;width:42%;color:#0f766e"><b>Fundamentalista</b></td><td style="padding:3px 14px 3px 0">a <b>última recomendação que cada casa publicou</b> até as 6h de ${researchDay} (a maioria é de dias ou semanas antes; poucas publicam algo novo antes das 6h) · indicadores (P/L, dividendos etc.) calculados com o <b>preço de fechamento${closeDay ? ` de ${closeDay}` : " do pregão anterior"}</b> e o <b>último balanço trimestral</b> de cada empresa · mudanças de recomendação dos <b>últimos 7 dias</b></td></tr>
    <tr><td style="padding:3px 14px 10px;vertical-align:top;color:#6d28d9"><b>Técnica (gráfico ${FRAME_LABEL[TF].toLowerCase()})</b></td><td style="padding:3px 14px 10px 0">fotografia do gráfico no fim <b>${techDa}</b>, o último candle já fechado. A tendência compara o preço com as médias de 50 e 200 ${{ diario: "pregões", semanal: "semanas", mensal: "meses" }[TF]}; cruzamentos contam se aconteceram ${{ diario: "nos últimos 5 pregões", semanal: "nas últimas 3 semanas", mensal: "nos últimos 2 meses" }[TF]}.</td></tr>
  </table>`;
const h2 = t => `<h2 style="font-size:17px;margin:26px 0 8px;padding-bottom:6px;border-bottom:2px solid ${LINE}">${t}</h2>`;
const hint = t => `<p style="margin:0 0 8px;color:${MUTED};font-size:13px">${t}</p>`;
const link = (e) => `<a href="${esc(cfg.site)}" style="color:#0f766e;text-decoration:none;font-weight:700">${esc(e.ticker)}</a>`;
const descLine = e => DESC[e.ticker] ? `<div style="font-size:12px;color:${MUTED}">${esc(DESC[e.ticker])}</div>` : "";
const botao = (href, txt) => `<p style="margin:12px 0 4px"><a href="${esc(href)}" style="display:inline-block;background:#0f766e;color:#ffffff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">${txt}</a></p>`;

// Every list is split by market (B3 stocks, US stocks, crypto…), in this order.
const MERCADOS = [
  ["b3", "🇧🇷 Ações do Brasil (B3)", e => e.bolsa === "B3"],
  ["eua", "🇺🇸 Ações dos EUA", e => e.bolsa === "EUA"],
  ["cripto", "🪙 Criptomoedas", e => e.bolsa === "Cripto" || /-(USD|BRL)$/.test(e.ticker)],
  ["outros", "Outros mercados", () => true],
];
const mercadoDe = e => MERCADOS.find(([, , t]) => t(e));
// items: anything; empOf(item) gives its company; render(sublist) draws one market's part.
function porMercado(items, empOf, render) {
  return MERCADOS.map(m => [m, items.filter(i => mercadoDe(empOf(i)) === m)]).filter(([, l]) => l.length)
    .map(([[, label], l]) => `<div style="font-size:12px;font-weight:700;color:#33414b;background:#f4f6f8;border-radius:6px;padding:5px 10px;margin:12px 0 2px;text-transform:uppercase;letter-spacing:.04em">${label} (${l.length})</div>${render(l)}`).join("");
}

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
  if (!list.length) return hint(prevRep ? "Nenhuma mudança desde o relatório anterior." : "Nenhum papel hoje.");
  return porMercado(list, ([e]) => e, l => signalTable(l, kind));
}
function signalTable(list, kind) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${list.map(([e, s]) => `
    <tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};vertical-align:top;width:70px">${link(e)}</td>
      <td style="padding:8px 0 8px 8px;border-bottom:1px solid ${LINE}"><b>${esc(e.nome)}</b>${antes(e) ? ` <span style="font-size:11px;font-weight:700;color:#ffffff;background:${kind === "compra" ? GREEN : AMBER};border-radius:4px;padding:1px 6px">${esc(antes(e))}</span>` : ""}${descLine(e)}
        <div style="font-size:13px">Cotação de ontem: <b>${money(price(e), cur(e))}</b>${e.consenso?.preco_alvo_medio ? ` · preço-alvo médio das casas: <b>${money(e.consenso.preco_alvo_medio, e.consenso.moeda || cur(e))}</b> (<span style="color:${upside(e) >= 0 ? GREEN : RED}">${upside(e) >= 0 ? "potencial de alta" : "abaixo do preço atual"}: ${pct(upside(e))}</span>)` : ""}</div>
        <div style="color:${kind === "compra" ? GREEN : AMBER};font-size:13px;font-weight:700;margin-top:3px">${esc(s.why.join(" · "))}</div>
        <div style="color:#33414b;font-size:13px;margin-top:3px;line-height:1.45"><b>Por quê:</b> ${justify(e, kind)}</div></td></tr>`).join("")}</table>`;
}

// Each company goes to the side its signals point to (weighted: golden/death cross > candles > short
// averages); buy alerts are listed first, then sell alerts, then the few that point both ways.
const techLado = x => { const n = x.reduce((a, t) => a + (t.sinal === "alta" ? 1 : t.sinal === "baixa" ? -1 : 0) * (t.peso + 1), 0); return n > 0 ? "alta" : n < 0 ? "baixa" : "misto"; };
function techSection(f) {
  const todos = emps.map(e => [e, techEvents(e, f)]).filter(([, x]) => x.length);
  const fora = todos.filter(([e]) => conflito(e, f)).map(([e]) => e);
  const ev = todos.filter(([e]) => !conflito(e, f)).sort((a, b) => b[1][0].peso - a[1][0].peso);
  const grupos = [["alta", "▲ Alerta de compra", GREEN], ["baixa", "▼ Alerta de venda", RED]]
    .map(([lado, titulo, cor]) => ({ titulo, cor, lista: ev.filter(([, x]) => techLado(x) === lado).map(([e, x]) => [e, x.slice().sort((a, b) => b.peso - a.peso)]) }))
    .filter(g => g.lista.length);
  const tabela = lista => `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">${lista.slice(0, 20).map(([e, x]) => `
      <tr><td style="padding:5px 0;border-bottom:1px solid ${LINE};width:70px;vertical-align:top">${link(e)}</td>
        <td style="padding:5px 0 5px 8px;border-bottom:1px solid ${LINE}">${x.map(t => `<span style="color:${color(t.sinal)}">${arrow(t.sinal)} ${esc(t.texto)}</span>`).join("<br>")}</td></tr>`).join("")}</table>
      ${lista.length > 20 ? hint(`…e mais ${lista.length - 20} no site.`) : ""}`;
  const biasTxt = list => { const b = { alta: 0, baixa: 0, neutro: 0 }; list.forEach(e => { const v = e.tecnica?.[f]?.vies; if (v) b[v]++; });
    return `<b style="color:${GREEN}">${b.alta} de alta</b>, <b style="color:${RED}">${b.baixa} de baixa</b>, ${b.neutro} neutras`; };
  const when = { diario: "último pregão", semanal: "última semana fechada", mensal: "último mês fechado" }[f];
  const mercado = list => {
    const gs = grupos.map(g => ({ ...g, lista: g.lista.filter(([e]) => list.includes(e)) })).filter(g => g.lista.length);
    return hint(`Tendência das ${list.length} acompanhadas: ${biasTxt(list)}.`)
      + (gs.length ? gs.map(g => `<div style="font-size:14px;font-weight:700;color:${g.cor};margin:8px 0 2px">${g.titulo} (${g.lista.length})</div>${tabela(g.lista)}`).join("") : hint("Nenhuma com cruzamento de médias ou candle de reversão recente neste gráfico."));
  };
  return `<h3 style="font-size:15px;margin:16px 0 4px">Empresas com sinais técnicos no gráfico ${FRAME_LABEL[f].toLowerCase()} (${ev.length}) <span style="font-weight:400;color:${MUTED};font-size:13px">· ${when}</span></h3>
    ${hint(`Tendência geral das ${emps.length} empresas acompanhadas neste gráfico: ${biasTxt(emps)}.`)}
    ${porMercado(emps, e => e, mercado)}
    ${fora.length ? hint(`<b>Fora das listas por terem alerta de compra e de venda ao mesmo tempo (${fora.length}):</b> ${fora.map(e => esc(e.ticker)).join(", ")}. Os sinais se anulam, então não indicam um lado.`) : ""}`;
}

function convRows(list, kind) {
  if (!list.length) return hint("Nenhum ativo hoje.");
  return porMercado(list, ([e]) => e, convTable);
}
function convTable(list) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${list.map(([e, s]) => { const t = e.tecnica[TF], ev = techEvents(e, TF); return `
    <tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};vertical-align:top;width:70px">${link(e)}</td>
      <td style="padding:8px 0 8px 8px;border-bottom:1px solid ${LINE}"><b>${esc(e.nome)}</b> · ${money(price(e), cur(e))}${descLine(e)}
        <div style="font-size:13px"><span style="color:#0f766e">📊 ${esc(s.why[0])}</span><br><span style="color:#6d28d9">📈 tendência ${esc(t.tendencia)}${ev.length ? " · " + esc(ev.map(x => x.texto).join(" · ")) : ""}</span></div></td></tr>`; }).join("")}</table>`;
}

function changesSection() {
  const all = emps.flatMap(e => (e.mudancas || []).map(m => [e, m])).sort((a, b) => b[1].data.localeCompare(a[1].data));
  if (!all.length) return hint("Nenhuma mudança relevante noticiada nos últimos 7 dias.");
  return porMercado(all, ([e]) => e, all => `<ul style="margin:0;padding-left:18px;font-size:14px">${all.map(([e, m]) => `<li style="margin:4px 0">${link(e)} — ${esc(m.descricao)} <span style="color:${MUTED}">(${esc(m.fonte)}, ${dateBR(m.data, { day: "2-digit", month: "2-digit" })})</span></li>`).join("")}</ul>`);
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
    ${MERCADOS.flatMap(m => { const l = rows.filter(e => mercadoDe(e) === m); return l.length ? [`<tr><td colspan="7" style="padding:8px 4px 3px;font-size:11px;font-weight:700;color:#33414b;background:#f4f6f8;text-transform:uppercase">${m[1]}</td></tr>`, ...l.map(e => { const k = e.consenso || {}; return `<tr><td style="padding:6px 4px;border-bottom:1px solid ${LINE}">${link(e)}${e.origem?.includes("lista pessoal") ? " ★" : ""}</td>
      ${td(money(price(e), cur(e)))}${td(`${k.compra || 0}·${k.neutro || 0}·${k.venda || 0}`)}${td(pct(upside(e)), `color:${upside(e) >= 0 ? GREEN : RED}`)}${td(num(e.indicadores?.pl))}${td(e.indicadores?.dy != null ? num(e.indicadores.dy) + "%" : "—")}${td(tech(e))}</tr>`; })] : []; }).join("")}
  </table></div>${hint(`★ sua lista · <b>Fundamentalista</b>: C·N·V = quantas casas recomendam compra, neutro e venda; Pot. = potencial até o preço-alvo médio; P/L e dividendos. <b>Técnica</b>: tendência no gráfico ${FRAME_LABEL[TF].toLowerCase()} (▲ alta, ▼ baixa, ■ neutro).`)}`;
}

const dayLong = dateBR(rep.data, { weekday: "long", day: "2-digit", month: "long" });
const nMud = buysNew.length + warnsNew.length + sairam.length;
const subject = `Radar do Mercado · ${dateBR(rep.data, { day: "2-digit", month: "2-digit" })} · ${prevRep ? `${nMud} ${nMud === 1 ? "mudança" : "mudanças"} nos sinais` : `${buys.length} sinais de compra, ${warns.length} de atenção`} · ${convBuy.length + convSell.length} onde as análises concordam`;
const prevDia = prevRep ? dateBR(prevRep.data, { day: "2-digit", month: "2-digit" }) : null;
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
    <tr><td>${datesBox}</td></tr>
    <tr><td style="font-size:13px;color:${MUTED};padding:0 4px">As duas se complementam: uma empresa pode ser boa (fundamentalista positiva) e o preço ainda estar caindo (técnica negativa), ou o contrário. A <b>Parte 3</b> mostra só os ativos em que as duas apontam para o mesmo lado.</td></tr>
  </table>

  <div style="margin:26px 0 0;padding:10px 14px;border-radius:8px;background:#0f766e;color:#ffffff;font-weight:700;font-size:16px">📊 PARTE 1 · ANÁLISE FUNDAMENTALISTA</div>
  ${hint("Baseada nas recomendações publicadas pelas casas de análise (resumidas por IA, com links no site) e nos indicadores das empresas (Fundamentus).")}

  ${prevRep ? `<p style="background:#e0f2ef;border-radius:8px;padding:10px 12px;font-size:14px;margin:10px 0 0">Aqui entram <b>só as mudanças</b> desde o relatório de ${prevDia}: empresas que ganharam um sinal ou trocaram de lado. Hoje há <b>${buys.length} sinais de compra</b> e <b>${warns.length} pontos de atenção</b> ao todo; ${buys.length + warns.length - buysNew.length - warnsNew.length} continuam iguais a ${prevDia} e estão no site.</p>${botao(siteSinais, `📋 Ver todas as recomendações (${buys.length + warns.length})`)}` : ""}

  ${h2(`🟢 ${prevRep ? "Novos sinais de compra" : "Sinais de compra"} (${buysNew.length})`)}
  ${hint(`A maioria das casas consultadas (mínimo ${C.min_casas}) recomenda compra <b>e</b> o papel passa nos critérios: P/L ≤ ${C.pl_max}, dividendos ≥ ${C.dy_min}%, ROE ≥ ${C.roe_min}%, dívida líq./patrimônio ≤ ${C.div_max}.`)}
  ${signalRows(buysNew, "compra")}

  ${h2(`🟠 ${prevRep ? "Novos pontos de atenção" : "Pontos de atenção"} (${warnsNew.length})`)}
  ${hint("Recomendações de venda, rebaixamentos recentes ou notícias negativas com indicadores fracos.")}
  ${signalRows(warnsNew, "atencao")}

  ${sairam.length ? `${h2(`⚪ Deixaram de ter sinal (${sairam.length})`)}${hint("Tinham sinal no relatório anterior e hoje não têm nenhum (mudou a recomendação de alguma casa, um indicador ou a notícia).")}<ul style="margin:0;padding-left:18px;font-size:14px">${sairam.map(p => `<li style="margin:4px 0">${link(p)} ${esc(p.nome)} — era ${KIND_TXT[prevKind.get(p.ticker)]}, agora sem sinal${sig.some(([e]) => e.ticker === p.ticker) ? "" : " (saiu do relatório)"}</li>`).join("")}</ul>` : ""}

  ${h2("📰 Mudanças recentes nas recomendações (7 dias)")}
  ${changesSection()}

  <div style="margin:30px 0 0;padding:10px 14px;border-radius:8px;background:#6d28d9;color:#ffffff;font-weight:700;font-size:16px">📈 PARTE 2 · ANÁLISE TÉCNICA · gráfico ${FRAME_LABEL[TF].toLowerCase()} · ${techPeriod}</div>
  ${hint(`Calculada por programa a partir dos preços, sem IA. Sinais considerados: cruzamento das médias curtas (MME 9 × MMS 21), golden/death cross (MMS 50 × MMS 200) e candles de reversão. Cada candle deste gráfico representa um dia de negociação. Aos sábados chega outro e-mail, com a análise técnica da semana no gráfico semanal.`)}
  ${techSection(TF)}

  <div style="margin:30px 0 0;padding:10px 14px;border-radius:8px;background:#b45309;color:#ffffff;font-weight:700;font-size:16px">🎯 PARTE 3 · ONDE AS DUAS ANÁLISES CONCORDAM</div>
  ${hint(`Só os ativos em que a análise fundamentalista e a técnica (gráfico ${FRAME_LABEL[TF].toLowerCase()}) apontam para o <b>mesmo lado</b>. Entram <b>todos</b> os sinais fundamentalistas em vigor (${buys.length} de compra, ${warns.length} de atenção), mesmo os que não mudaram desde ontem. Do lado técnico, vale um alerta recente de compra ou de venda; sem alerta, vale a tendência. Cruza a fundamentalista (pesquisa das 6h de <b>${researchDay}</b>${closeDay ? `, preços de ${closeDay}` : ""}) com o gráfico ${FRAME_LABEL[TF].toLowerCase()} <b>${techDa}</b>.`)}
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

/* ---------- Saturday e-mail: the week on the weekly chart ---------- */
const weekRows = lado => emps.filter(e => e.tecnica?.semanal?.vies === lado).sort((a, b) => Math.abs(b.tecnica.semanal.pontuacao) - Math.abs(a.tecnica.semanal.pontuacao));
const weekList = lado => { const l = weekRows(lado); return l.length ? porMercado(l, e => e, l => `<p style="margin:0 0 8px;font-size:14px">${l.map(e => `${link(e)}${e.origem?.includes("lista pessoal") ? " ★" : ""}`).join(" · ")}</p>`) : hint("Nenhuma."); };
const weekSubject = `Radar do Mercado · análise técnica da ${techPeriod}`;
const weekHtml = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(weekSubject)}</title></head>
<body style="margin:0;background:#f4f6f8"><div style="max-width:680px;margin:0 auto;padding:20px 16px;font-family:Arial,Helvetica,sans-serif;color:#0f1b24;line-height:1.5;background:#ffffff">
  <div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;font-weight:700">Radar do Mercado · resumo da semana</div>
  <h1 style="font-size:22px;margin:4px 0 2px">Análise técnica da ${techPeriod}</h1>
  ${hint(`${emps.length} empresas · Ibovespa + sua lista · gráfico semanal: cada candle é uma semana de negociação, de segunda a sexta`)}
  <p style="background:#ede9fe;border-left:4px solid #6d28d9;border-radius:8px;padding:12px 14px;font-size:14px;margin:14px 0">
    Os e-mails de segunda a sexta olham o <b>gráfico diário</b>, que reage rápido e muda de um dia para o outro.
    Este olha o <b>gráfico semanal</b>: o que a semana inteira deixou no preço. Sinais aqui demoram mais para aparecer, mas costumam ser mais firmes.
    A tendência compara o preço com as médias de 50 e 200 semanas; cruzamentos contam se aconteceram nas últimas 3 semanas.
  </p>
  ${h2("📈 Sinais técnicos da semana")}
  ${hint("Calculada por programa a partir dos preços, sem IA. Sinais considerados: cruzamento das médias curtas (MME 9 × MMS 21), golden/death cross (MMS 50 × MMS 200) e candles de reversão.")}
  ${techSection("semanal")}
  ${h2("🧭 Tendência de cada empresa no gráfico semanal")}
  ${hint("Ordenadas da mais forte para a mais fraca, somando todos os sinais (tendência, cruzamentos, IFR e candles). ★ sua lista.")}
  <div style="font-size:14px;font-weight:700;color:${GREEN};margin:10px 0 2px">▲ Viés de alta (${weekRows("alta").length})</div>${weekList("alta")}
  <div style="font-size:14px;font-weight:700;color:${RED};margin:10px 0 2px">▼ Viés de baixa (${weekRows("baixa").length})</div>${weekList("baixa")}
  ${hint(`As outras ${emps.length - weekRows("alta").length - weekRows("baixa").length} estão neutras.`)}
  <p style="margin:28px 0 8px"><a href="${esc(cfg.site)}" style="display:inline-block;background:#0f766e;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Abrir o painel completo</a></p>
  <p style="font-size:12px;color:#8c99a3;margin-top:24px">Cotações e candles: Yahoo Finance. Análise técnica calculada por programa, sem IA. Não é recomendação de investimento.</p>
</div></body></html>`;
const weekText = [`Radar do Mercado — análise técnica da ${techPeriod} (gráfico semanal)`, "",
  `Viés de alta: ${weekRows("alta").map(e => e.ticker).join(", ") || "nenhuma"}`, `Viés de baixa: ${weekRows("baixa").map(e => e.ticker).join(", ") || "nenhuma"}`, "",
  `Painel completo: ${cfg.site}`].join("\n");

const text = [
  `Radar do Mercado — relatório de ${dayLong}`, "", rep.resumo_mercado, "",
  `${prevRep ? "Novos sinais de compra" : "Sinais de compra"} (${buysNew.length}): ${buysNew.map(([e]) => e.ticker).join(", ") || "nenhum"}`,
  `${prevRep ? "Novos pontos de atenção" : "Pontos de atenção"} (${warnsNew.length}): ${warnsNew.map(([e]) => e.ticker).join(", ") || "nenhum"}`,
  ...(sairam.length ? [`Deixaram de ter sinal: ${sairam.map(p => p.ticker).join(", ")}`] : []),
  `Todas as recomendações: ${siteSinais}`, "",
  `As duas análises concordam — compra: ${convBuy.map(([e]) => e.ticker).join(", ") || "nenhum"}; venda: ${convSell.map(([e]) => e.ticker).join(", ") || "nenhum"}`, "",
  `Painel completo: ${cfg.site}`,
].join("\n");

/* ---------- output ---------- */
const out = WEEKLY ? { subject: weekSubject, html: weekHtml, text: weekText } : { subject, html, text };
const pv = args.indexOf("--preview");
if (pv >= 0) {
  const file = args[pv + 1] && !args[pv + 1].startsWith("--") ? args[pv + 1] : "email-preview.html";
  await writeFile(file, out.html);
  console.log(`Prévia gravada em ${file} — assunto: ${out.subject}`);
} else {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !EMAIL_TO) { console.error("Faltam GMAIL_USER, GMAIL_APP_PASSWORD ou EMAIL_TO."); process.exit(1); }
  await sendGmail({ user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s/g, ""), to: EMAIL_TO, ...out });
  console.log(`E-mail enviado — ${out.subject}`);
}
