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
const staleResearch = rep.pesquisa_data && rep.pesquisa_data !== rep.data;
const h2 = t => `<h2 style="font-size:17px;margin:26px 0 8px;padding-bottom:6px;border-bottom:2px solid ${LINE}">${t}</h2>`;
const hint = t => `<p style="margin:0 0 8px;color:${MUTED};font-size:13px">${t}</p>`;
const link = (e) => `<a href="${esc(cfg.site)}" style="color:#0f766e;text-decoration:none;font-weight:700">${esc(e.ticker)}</a>`;

function signalRows(list, kind) {
  if (!list.length) return hint("Nenhum papel hoje.");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${list.map(([e, s]) => `
    <tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};vertical-align:top;width:70px">${link(e)}</td>
      <td style="padding:8px 0 8px 8px;border-bottom:1px solid ${LINE}"><b>${esc(e.nome)}</b> · ${money(price(e), cur(e))}${e.consenso?.preco_alvo_medio ? ` · alvo médio ${money(e.consenso.preco_alvo_medio, e.consenso.moeda || cur(e))} (<span style="color:${upside(e) >= 0 ? GREEN : RED}">${pct(upside(e))}</span>)` : ""}
        <div style="color:${kind === "compra" ? GREEN : AMBER};font-size:13px">${esc(s.why.join(" · "))}</div></td></tr>`).join("")}</table>`;
}

function techSection(f) {
  const ev = emps.map(e => [e, techEvents(e, f)]).filter(([, x]) => x.length).sort((a, b) => b[1][0].peso - a[1][0].peso);
  const bias = { alta: 0, baixa: 0, neutro: 0 };
  emps.forEach(e => { const v = e.tecnica?.[f]?.vies; if (v) bias[v]++; });
  const when = { diario: "último pregão", semanal: "última semana fechada", mensal: "último mês fechado" }[f];
  return `<h3 style="font-size:15px;margin:16px 0 4px">${FRAME_LABEL[f]} <span style="font-weight:400;color:${MUTED};font-size:13px">(${when})</span></h3>
    ${hint(`Viés técnico das ${emps.length} empresas: <b style="color:${GREEN}">${bias.alta} de alta</b>, <b style="color:${RED}">${bias.baixa} de baixa</b>, ${bias.neutro} neutras.`)}
    ${ev.length ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">${ev.slice(0, 20).map(([e, x]) => `
      <tr><td style="padding:5px 0;border-bottom:1px solid ${LINE};width:70px;vertical-align:top">${link(e)}</td>
        <td style="padding:5px 0 5px 8px;border-bottom:1px solid ${LINE}">${x.map(t => `<span style="color:${color(t.sinal)}">${arrow(t.sinal)} ${esc(t.texto)}</span>`).join("<br>")}</td></tr>`).join("")}</table>
      ${ev.length > 20 ? hint(`…e mais ${ev.length - 20} no site.`) : ""}` : hint("Nenhum cruzamento de médias ou candle de reversão recente.")}`;
}

function changesSection() {
  const all = emps.flatMap(e => (e.mudancas || []).map(m => [e, m])).sort((a, b) => b[1].data.localeCompare(a[1].data));
  if (!all.length) return hint("Nenhuma mudança relevante noticiada nos últimos 7 dias.");
  return `<ul style="margin:0;padding-left:18px;font-size:14px">${all.map(([e, m]) => `<li style="margin:4px 0">${link(e)} — ${esc(m.descricao)} <span style="color:${MUTED}">(${esc(m.fonte)}, ${dateBR(m.data, { day: "2-digit", month: "2-digit" })})</span></li>`).join("")}</ul>`;
}

function overviewTable() {
  const mine = emps.filter(e => e.origem?.includes("lista pessoal"));
  const top = emps.filter(e => e.peso_ibov != null).slice(0, cfg.maiores_do_ibovespa_na_tabela || 15);
  const rows = [...new Map([...mine, ...top].map(e => [e.ticker, e])).values()];
  const th = t => `<th style="text-align:right;padding:5px 3px;font-size:10px;color:${MUTED};border-bottom:2px solid ${LINE};white-space:nowrap">${t}</th>`;
  const td = (t, extra = "") => `<td style="text-align:right;padding:5px 3px;border-bottom:1px solid ${LINE};white-space:nowrap;${extra}">${t}</td>`;
  const tech = e => cfg.tempos_graficos.map(f => { const v = e.tecnica?.[f]?.vies; return v ? `<span style="color:${color(v)}">${arrow(v)}</span>` : "·"; }).join(" ");
  return `<div style="overflow-x:auto"><table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;width:100%">
    <tr><th style="text-align:left;padding:6px 4px;font-size:11px;color:${MUTED};border-bottom:2px solid ${LINE}">Ativo</th>${th("Preço")}${th("C·N·V")}${th("Pot.")}${th("P/L")}${th("Div.")}${th("Téc. " + cfg.tempos_graficos.map(f => FRAME_LABEL[f][0]).join("/"))}</tr>
    ${rows.map(e => { const k = e.consenso || {}; return `<tr><td style="padding:6px 4px;border-bottom:1px solid ${LINE}">${link(e)}${e.origem?.includes("lista pessoal") ? " ★" : ""}</td>
      ${td(money(price(e), cur(e)))}${td(`${k.compra || 0}·${k.neutro || 0}·${k.venda || 0}`)}${td(pct(upside(e)), `color:${upside(e) >= 0 ? GREEN : RED}`)}${td(num(e.indicadores?.pl))}${td(e.indicadores?.dy != null ? num(e.indicadores.dy) + "%" : "—")}${td(tech(e))}</tr>`; }).join("")}
  </table></div>${hint(`★ sua lista · Casas C·N·V = quantas recomendam compra, neutro, venda · Téc. = viés técnico ${cfg.tempos_graficos.map(f => FRAME_LABEL[f].toLowerCase()).join("/")} (▲ alta, ▼ baixa, ■ neutro)`)}`;
}

const dayLong = dateBR(rep.data, { weekday: "long", day: "2-digit", month: "long" });
const subject = `Radar do Mercado · ${dateBR(rep.data, { day: "2-digit", month: "2-digit" })} · ${buys.length} sinais de compra, ${warns.length} de atenção`;
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8">
<div style="max-width:680px;margin:0 auto;padding:20px 16px;font-family:Arial,Helvetica,sans-serif;color:#0f1b24;line-height:1.5;background:#ffffff">
  <div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;font-weight:700">Radar do Mercado</div>
  <h1 style="font-size:22px;margin:4px 0 2px">Relatório de ${esc(dayLong)}</h1>
  ${hint(`${emps.length} empresas · Ibovespa + sua lista · análise técnica: ${cfg.tempos_graficos.map(f => FRAME_LABEL[f].toLowerCase()).join(", ")}`)}
  ${staleResearch ? `<p style="background:#fff3dc;color:${AMBER};padding:10px 12px;border-radius:8px;font-size:14px"><b>Atenção:</b> a pesquisa de notícias de hoje não rodou; recomendações e notícias são de ${dateBR(rep.pesquisa_data)}. Preços, indicadores e análise técnica estão atualizados.</p>` : ""}
  <p style="font-size:15px;margin:14px 0">${esc(rep.resumo_mercado)}</p>

  ${h2(`🟢 Sinais de compra (${buys.length})`)}
  ${hint(`A maioria das casas consultadas (mínimo ${C.min_casas}) recomenda compra <b>e</b> o papel passa nos critérios: P/L ≤ ${C.pl_max}, dividendos ≥ ${C.dy_min}%, ROE ≥ ${C.roe_min}%, dívida líq./patrimônio ≤ ${C.div_max}.`)}
  ${signalRows(buys, "compra")}

  ${h2(`🟠 Pontos de atenção (${warns.length})`)}
  ${hint("Recomendações de venda, rebaixamentos recentes ou notícias negativas com indicadores fracos.")}
  ${signalRows(warns, "atencao")}

  ${h2("📈 Análise técnica")}
  ${hint("Cruzamentos de médias móveis (MME 9 × MMS 21; MMS 50 × MMS 200 — golden/death cross) e candles de reversão, calculados a partir dos preços.")}
  ${cfg.tempos_graficos.map(techSection).join("")}

  ${h2("📰 Mudanças recentes (7 dias)")}
  ${changesSection()}

  ${h2("📋 Visão geral")}
  ${overviewTable()}

  <p style="margin:28px 0 8px"><a href="${esc(cfg.site)}" style="display:inline-block;background:#0f766e;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Abrir o painel completo</a></p>
  <p style="font-size:12px;color:#8c99a3;margin-top:24px">Resumo automático do que fontes publicadas dizem, feito por IA (pode conter erros — confira os links no site). Indicadores: Fundamentus. Cotações e candles: Yahoo Finance. Análise técnica calculada por programa, sem IA. Não é recomendação de investimento.</p>
</div></body></html>`;

const text = [
  `Radar do Mercado — relatório de ${dayLong}`, "", rep.resumo_mercado, "",
  `Sinais de compra (${buys.length}): ${buys.map(([e]) => e.ticker).join(", ") || "nenhum"}`,
  `Pontos de atenção (${warns.length}): ${warns.map(([e]) => e.ticker).join(", ") || "nenhum"}`, "",
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
