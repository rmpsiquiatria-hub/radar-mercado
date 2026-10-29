// Radar de leis e-mail: the routine's analysis (relatorios/leis/ultimo.json) of the day's collection
// (coleta.json). If the analysis for that day is missing, it sends the plain list of the main acts.
// What goes in follows config.json → leis (chosen in the site's Settings): which highlight areas, and
// which categories are also listed without analysis.
//   node scripts/leis-email.mjs --preview saida.html   → only writes the HTML
//   node scripts/leis-email.mjs                        → sends; needs GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO
import { readFile, writeFile } from "node:fs/promises";
import { sendGmail } from "./gmail.mjs";
import { CATEGORIAS, AREAS } from "./leis-categorias.mjs";

const dir = new URL("../relatorios/leis/", import.meta.url);
const col = JSON.parse(await readFile(new URL("coleta.json", dir), "utf8"));
const an = await readFile(new URL("ultimo.json", dir), "utf8").then(JSON.parse).catch(() => null);
const cfg = JSON.parse(await readFile(new URL("../config.json", dir), "utf8"));
const ok = an && an.data === col.data;
const pref = { destaques: Object.keys(AREAS), lista: [], ...(cfg.leis || {}) };
const area = d => d.area || "outros";
if (an?.destaques) an.destaques = an.destaques.filter(d => pref.destaques.includes(area(d)));
const LISTA_MAX = 15;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dataBR = (s, o) => new Date(s + "T12:00:00").toLocaleDateString("pt-BR", o);
const MUTED = "#5d6b76", LINE = "#e3e8ec", NAVY = "#1e3a8a";
const ESF = { federal: "🏛️ Federal", estadual: "🧉 Estadual (RS)", municipal: "🏘️ Municipal (Lajeado)" };
const h2 = t => `<h2 style="font-size:17px;margin:26px 0 8px;padding-bottom:6px;border-bottom:2px solid ${LINE}">${t}</h2>`;
const hint = t => `<p style="margin:0 0 8px;color:${MUTED};font-size:13px">${t}</p>`;
const cont = e => col.itens.filter(i => i.esfera === e).length;
const normas = e => col.itens.filter(i => i.esfera === e && !i.lista).length;
// the categories chosen to be listed too (without analysis), per sphere; highlights are not repeated
function listas(e) {
  const dest = new Set((an?.destaques || []).map(d => d.id));
  return pref.lista.map(k => {
    const l = col.itens.filter(i => i.esfera === e && !dest.has(i.id) && (i.cats || ["outros"]).includes(k));
    if (!l.length) return "";
    return `<div style="font-size:13px;font-weight:700;margin:12px 0 4px">${CATEGORIAS[k]} <span style="font-weight:400;color:${MUTED}">(${l.length})</span></div>
      <ul style="padding-left:18px;margin:0">${l.slice(0, LISTA_MAX).map(i => `<li style="margin:0 0 4px;font-size:13px"><a href="${esc(i.url)}" style="color:${NAVY}">${esc(i.titulo)}</a>${i.orgao || i.unidade ? ` <span style="color:${MUTED};font-size:12px">· ${esc(i.unidade || i.orgao)}</span>` : ""}${i.ementa ? `<br><span style="color:${MUTED};font-size:12px">${esc(i.ementa.slice(0, 140))}…</span>` : ""}</li>`).join("")}
      ${l.length > LISTA_MAX ? `<li style="color:${MUTED};font-size:12px">… e mais ${l.length - LISTA_MAX} no site</li>` : ""}</ul>`;
  }).join("");
}
const filtroTxt = () => {
  const d = pref.destaques.length === Object.keys(AREAS).length ? "todos" : pref.destaques.map(k => AREAS[k].replace(/^\S+ /, "")).join(", ") || "nenhum";
  return `Seu filtro: destaques ${d === "todos" ? "de todas as áreas" : "de " + d}${pref.lista.length ? " · também listados: " + pref.lista.map(k => CATEGORIAS[k].replace(/^\S+ /, "")).join(", ") : ""}. Mude em Configurações → Radar de leis, no site.`;
};
const falhas = Object.entries(col.fontes).filter(([, f]) => !f.ok).map(([e, f]) => `${ESF[e]}: ${esc(f.erro)}`);

// Tax change: before → after and the change in %.
function imposto(t) {
  if (!t) return "";
  const v = typeof t.variacao_pct === "number" ? t.variacao_pct : null, cor = v > 0 ? "#c9302c" : v < 0 ? "#0a8a4a" : MUTED;
  const cel = (k, x, st = "") => `<td style="padding:2px 14px 2px 0;vertical-align:bottom"><div style="font-size:11px;color:${MUTED}">${k}</div><div style="font-weight:700;font-size:14px;${st}">${x}</div></td>`;
  return `<div style="background:#f6f8fa;border:1px solid ${LINE};border-radius:6px;padding:6px 10px;margin:0 0 6px">
    <div style="font-size:12px;color:${MUTED}">💰 ${esc(t.tributo)}</div>
    <table cellpadding="0" cellspacing="0"><tr>${cel("Antes", esc(t.antes))}${cel("Agora", esc(t.depois))}${v != null ? cel("Variação", (v > 0 ? "+" : "") + v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%", "color:" + cor) : ""}</tr></table>
    ${t.obs ? `<div style="font-size:12px;color:${MUTED}">${esc(t.obs)}</div>` : ""}</div>`;
}
function card(d) {
  const row = (k, v) => v ? `<tr><td style="padding:3px 10px 3px 0;color:${MUTED};font-size:13px;vertical-align:top;width:110px">${k}</td><td style="padding:3px 0;font-size:14px">${esc(v)}</td></tr>` : "";
  return `<div style="border:1px solid ${LINE};border-left:4px solid ${d.relevancia === "alta" ? "#c9302c" : "#b26b00"};border-radius:8px;padding:10px 12px;margin:0 0 10px">
    <div style="font-size:12px;color:${MUTED}">${esc(d.orgao)}${d.temas?.length ? " · " + d.temas.map(esc).join(", ") : ""}</div>
    <div style="font-weight:700;font-size:15px;margin:2px 0 6px"><a href="${esc(d.url)}" style="color:${NAVY};text-decoration:none">${esc(d.titulo)}</a></div>
    ${imposto(d.imposto)}
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">${row("O que muda", d.o_que_muda)}${row("Quem é afetado", d.quem_afeta)}${row("Vigência", d.vigencia)}</table></div>`;
}

let corpo, subject;
if (ok) {
  const alta = an.destaques.filter(d => d.relevancia === "alta"), media = an.destaques.filter(d => d.relevancia !== "alta");
  subject = `Radar de leis · ${dataBR(col.data, { day: "2-digit", month: "2-digit" })} · ${an.destaques.length} destaques${alta.length ? ` (${alta.length} importantes)` : ""}`;
  // one section per sphere: summary, highlights (most important first), then the rest of the day
  corpo = ["federal", "estadual", "municipal"].map(e => {
    const de = an.destaques.filter(d => d.esfera === e);
    return h2(`${ESF[e]} <span style="font-weight:400;color:${MUTED};font-size:13px">· ${cont(e)} publicações · ${de.length} destaques</span>`)
      + `<div style="background:#eef2ff;border-radius:8px;padding:10px 14px;font-size:14px;line-height:1.5;margin:0 0 10px">${esc(an.resumo?.[e] || "")}</div>`
      + de.map(card).join("")
      + (an.demais?.[e] ? `<p style="font-size:13px;color:${MUTED};margin:4px 0 0"><b>O restante:</b> ${esc(an.demais[e])}</p>` : "")
      + listas(e);
  }).join("");
} else {
  // No analysis: the main acts by type, straight from the collection.
  const PRINC = /^(lei|medida provis|decreto|emenda|instru[çc][ãa]o normativa|resolu|portaria (interministerial|conjunta|normativa)|ato normativo)/i;
  const lista = e => { const l = col.itens.filter(i => i.esfera === e && !i.lista && (e === "municipal" || PRINC.test(i.tipo || "") || PRINC.test(i.titulo || "")));
    return l.length ? l.slice(0, 40).map(i => `<li style="margin:0 0 6px;font-size:14px"><a href="${esc(i.url)}" style="color:${NAVY}">${esc(i.titulo)}</a><br><span style="color:${MUTED};font-size:12px">${esc(i.unidade || i.orgao)}${i.ementa ? " · " + esc(i.ementa.slice(0, 160)) + "…" : ""}</span></li>`).join("") + (l.length > 40 ? `<li style="color:${MUTED}">… e mais ${l.length - 40} no site</li>` : "") : `<li style="color:${MUTED}">nada deste tipo</li>`; };
  subject = `Radar de leis · ${dataBR(col.data, { day: "2-digit", month: "2-digit" })} · lista do dia (sem análise)`;
  corpo = `
  <div style="background:#fff7e6;border:1px solid #f0c36d;border-radius:8px;padding:10px 14px;font-size:14px">⚠️ A análise por IA deste dia não ficou pronta. Abaixo, a lista das leis, decretos, instruções normativas e resoluções publicados, sem comentários.</div>
  ${["federal", "estadual", "municipal"].map(e => h2(`${ESF[e]} (${cont(e)} publicações)`) + `<ul style="padding-left:18px;margin:0">${lista(e)}</ul>` + listas(e)).join("")}`;
}

const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#17212b">
<div style="max-width:680px;margin:0 auto;background:#fff;padding:20px 22px">
  <div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em">Radar de leis</div>
  <h1 style="font-size:22px;margin:4px 0 2px">⚖️ Publicado em ${esc(dataBR(col.data, { weekday: "long", day: "numeric", month: "long" }))}</h1>
  ${hint(`Diário Oficial da União: ${normas("federal")} atos normativos (Seção 1) e ${cont("federal") - normas("federal")} de pessoal, contratos e empresas (Seções 2 e 3) · Diário Oficial do RS: ${normas("estadual")} atos normativos e ${cont("estadual") - normas("estadual")} de pessoal, contratos e licitações · Diário Oficial de Lajeado: ${cont("municipal")} atos`)}
  ${hint(filtroTxt())}
  ${falhas.length ? `<div style="background:#fdecea;border-radius:8px;padding:8px 12px;font-size:13px;margin:6px 0">Fonte que não pôde ser lida hoje: ${falhas.join(" · ")}</div>` : ""}
  ${corpo}
  <p style="margin-top:22px;font-size:14px">Lista completa e explicação de cada fonte: <a href="${esc(cfg.site)}" style="color:${NAVY}">Radar do Mercado → Educação → Direito</a></p>
  <p style="font-size:12px;color:#8c99a3;margin-top:18px">Coleta automática dos diários oficiais, sem IA. Resumos feitos por IA a partir do texto publicado: podem conter erros, confira sempre o link oficial. Não é orientação jurídica.</p>
</div></body></html>`;
const text = [subject, "", ok ? ["federal", "estadual", "municipal"].map(e => `${ESF[e]}: ${an.resumo?.[e] || ""}`).join("\n") : "A análise deste dia não ficou pronta; veja a lista no site.", "",
  ...(ok ? an.destaques.map(d => `• [${d.relevancia}] ${d.titulo} — ${d.o_que_muda} ${d.url}`) : []), "", `Site: ${cfg.site}`].join("\n");

const args = process.argv.slice(2);
if (args[0] === "--preview") {
  await writeFile(args[1] || "leis-preview.html", html);
  console.log(`Prévia gravada em ${args[1] || "leis-preview.html"} — assunto: ${subject}`);
} else {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !EMAIL_TO) { console.error("Faltam GMAIL_USER, GMAIL_APP_PASSWORD ou EMAIL_TO."); process.exit(1); }
  await sendGmail({ user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s/g, ""), to: EMAIL_TO, subject, html, text, from: "Radar de leis" });
  console.log(`E-mail enviado — ${subject}`);
}
