// Builds relatorios/tecnica.json: technical analysis for every company in
// relatorios/indicadores.json, on daily, weekly and monthly candles (Yahoo Finance).
// Moving averages and their crossovers, RSI, MACD, Bollinger bands, trend,
// support/resistance and candlestick reversal patterns. No AI involved.
// Run: node scripts/tecnica.mjs

import { readFile, writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const rel = new URL("../relatorios/", import.meta.url);

// Per timeframe: Yahoo range/interval, how many recent bars count as "recent" for a crossover,
// and the move that defines the trend before a candle pattern.
const FRAMES = {
  diario: { range: "2y", interval: "1d", recent: 5, trendMove: 0.02, label: "pregões" },
  semanal: { range: "10y", interval: "1wk", recent: 3, trendMove: 0.04, label: "semanas" },
  mensal: { range: "20y", interval: "1mo", recent: 2, trendMove: 0.06, label: "meses" },
};

async function candles(symbol, { range, interval }) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.ok) {
      const res = (await r.json())?.chart?.result?.[0];
      const q = res?.indicators?.quote?.[0];
      if (!res?.timestamp || !q) return [];
      const out = [];
      res.timestamp.forEach((t, i) => {
        const [o, h, l, c, v] = [q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i]];
        if ([o, h, l, c].every(x => x != null && x > 0)) out.push({ t, o, h, l, c, v: v || 0 });
      });
      return out;
    }
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`Yahoo falhou para ${symbol}`);
}

// Drop the bar of a period that has not closed yet (today, this week, this month),
// so patterns and crossovers are read from finished candles only.
function closedOnly(bars, frame) {
  // Yahoo appends an extra "live" bar stamped with the last trade time
  // (e.g. a weekly series ending ...10-19, ...10-23 20:00): drop it first.
  const minGapDays = { diario: 0.5, semanal: 6, mensal: 27 }[frame];
  if (bars.length > 1 && (bars.at(-1).t - bars.at(-2).t) / 86400 < minGapDays) bars = bars.slice(0, -1);
  if (!bars.length) return bars;
  const last = new Date(bars.at(-1).t * 1000);
  const now = new Date();
  const ymd = d => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  let open = false;
  if (frame === "diario") open = ymd(last) === ymd(now) && now.getUTCHours() < 21;
  // Weekly bars start Monday 00:00 local; the week closes Friday evening (~4.8 days later).
  if (frame === "semanal") open = (now - last) / 864e5 < 4.8;
  if (frame === "mensal") open = ymd(last).slice(0, 7) === ymd(now).slice(0, 7);
  return open ? bars.slice(0, -1) : bars;
}

const sma = (xs, n) => xs.map((_, i) => i + 1 < n ? null : xs.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n);
function ema(xs, n) {
  const k = 2 / (n + 1), out = []; let prev = null;
  xs.forEach((x, i) => {
    if (i + 1 < n) { out.push(null); return; }
    prev = prev == null ? xs.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n : x * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}
function rsi(xs, n = 14) {
  const out = Array(xs.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) out[i] = l ? 100 - 100 / (1 + g / l) : 100; continue; }
    g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
    out[i] = l ? 100 - 100 / (1 + g / l) : 100;
  }
  return out;
}
function stdev(xs, n) {
  const m = sma(xs, n);
  return xs.map((_, i) => m[i] == null ? null : Math.sqrt(xs.slice(i + 1 - n, i + 1).reduce((a, x) => a + (x - m[i]) ** 2, 0) / n));
}

// Last bar index (within the last `recent` bars) where series a crossed series b.
function lastCross(a, b, recent) {
  for (let i = a.length - 1; i >= Math.max(1, a.length - recent); i--) {
    if ([a[i], b[i], a[i - 1], b[i - 1]].some(x => x == null)) continue;
    if (a[i - 1] <= b[i - 1] && a[i] > b[i]) return { i, dir: "alta" };
    if (a[i - 1] >= b[i - 1] && a[i] < b[i]) return { i, dir: "baixa" };
  }
  return null;
}

function patterns(b, move) {
  const n = b.length; if (n < 8) return [];
  const P = [], k = n - 1;
  const body = x => Math.abs(x.c - x.o), rng = x => x.h - x.l || 1e-9;
  const up = x => x.c > x.o, dn = x => x.c < x.o;
  const upper = x => x.h - Math.max(x.o, x.c), lower = x => Math.min(x.o, x.c) - x.l;
  const trendBefore = i => { const ch = b[i - 1].c / b[i - 6].c - 1; return ch > move ? "alta" : ch < -move ? "baixa" : "lateral"; };
  const avgBody = b.slice(n - 11, n - 1).reduce((a, x) => a + body(x), 0) / 10 || 1e-9;
  const long = x => body(x) > avgBody * 1.1;
  const c = b[k], p = b[k - 1], pp = b[k - 2], tr = trendBefore(k), tr2 = trendBefore(k - 1);
  const add = (nome, sinal, descricao) => P.push({ nome, sinal, descricao });

  if (lower(c) >= 2 * body(c) && upper(c) <= Math.max(body(c), rng(c) * 0.1)) {
    if (tr === "baixa") add("Martelo", "alta", "Sombra inferior longa depois de queda: compradores reagiram no fundo.");
    if (tr === "alta") add("Enforcado", "baixa", "Sombra inferior longa depois de alta: sinal de cansaço dos compradores.");
  }
  if (upper(c) >= 2 * body(c) && lower(c) <= Math.max(body(c), rng(c) * 0.1)) {
    if (tr === "alta") add("Estrela cadente", "baixa", "Sombra superior longa depois de alta: vendedores rejeitaram preços mais altos.");
    if (tr === "baixa") add("Martelo invertido", "alta", "Sombra superior longa depois de queda: primeira tentativa de reação.");
  }
  if (dn(p) && up(c) && c.c >= p.o && c.o <= p.c && body(c) > body(p) && tr2 === "baixa") add("Engolfo de alta", "alta", "Candle de alta engoliu o corpo do candle de baixa anterior, depois de queda.");
  if (up(p) && dn(c) && c.o >= p.c && c.c <= p.o && body(c) > body(p) && tr2 === "alta") add("Engolfo de baixa", "baixa", "Candle de baixa engoliu o corpo do candle de alta anterior, depois de alta.");
  if (long(p) && dn(p) && up(c) && Math.max(c.o, c.c) < p.o && Math.min(c.o, c.c) > p.c && tr2 === "baixa") add("Harami de alta", "alta", "Candle pequeno de alta dentro do corpo de um candle de baixa longo: a queda perdeu força.");
  if (long(p) && up(p) && dn(c) && Math.max(c.o, c.c) < p.c && Math.min(c.o, c.c) > p.o && tr2 === "alta") add("Harami de baixa", "baixa", "Candle pequeno de baixa dentro do corpo de um candle de alta longo: a alta perdeu força.");
  if (long(p) && dn(p) && up(c) && c.o < p.c && c.c > (p.o + p.c) / 2 && c.c < p.o && tr2 === "baixa") add("Piercing line", "alta", "Abriu abaixo e fechou acima da metade do candle de baixa anterior.");
  if (long(p) && up(p) && dn(c) && c.o > p.c && c.c < (p.o + p.c) / 2 && c.c > p.o && tr2 === "alta") add("Nuvem negra", "baixa", "Abriu acima e fechou abaixo da metade do candle de alta anterior.");
  if (k >= 8 && long(pp) && dn(pp) && body(p) < avgBody * 0.5 && up(c) && c.c > (pp.o + pp.c) / 2 && trendBefore(k - 2) === "baixa") add("Estrela da manhã", "alta", "Queda forte, candle pequeno de indecisão e alta forte: padrão clássico de reversão para cima.");
  if (k >= 8 && long(pp) && up(pp) && body(p) < avgBody * 0.5 && dn(c) && c.c < (pp.o + pp.c) / 2 && trendBefore(k - 2) === "alta") add("Estrela da noite", "baixa", "Alta forte, candle pequeno de indecisão e queda forte: padrão clássico de reversão para baixo.");
  if ([pp, p, c].every(x => up(x) && long(x)) && p.c > pp.c && c.c > p.c && p.o > pp.o && c.o > p.o) add("Três soldados brancos", "alta", "Três candles de alta fortes e seguidos.");
  if ([pp, p, c].every(x => dn(x) && long(x)) && p.c < pp.c && c.c < p.c && p.o < pp.o && c.o < p.o) add("Três corvos negros", "baixa", "Três candles de baixa fortes e seguidos.");
  if (!P.length && body(c) <= rng(c) * 0.1 && tr !== "lateral") add("Doji", "neutro", `Indecisão (abertura ≈ fechamento) depois de ${tr === "alta" ? "alta" : "queda"}: pode anteceder reversão.`);
  return P;
}

function analyze(barsAll, frameKey) {
  const f = FRAMES[frameKey];
  const b = closedOnly(barsAll, frameKey);
  if (b.length < 30) return null;
  const C = b.map(x => x.c), n = C.length, k = n - 1;
  const m9 = ema(C, 9), m21 = sma(C, 21), m50 = sma(C, 50), m200 = sma(C, 200);
  const r = rsi(C), e12 = ema(C, 12), e26 = ema(C, 26);
  const macd = C.map((_, i) => e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null);
  const sigStart = macd.findIndex(x => x != null);
  const sig = Array(sigStart).fill(null).concat(ema(macd.slice(sigStart), 9));
  const sd = stdev(C, 20), bm = sma(C, 20);
  const date = i => new Date(b[i].t * 1000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const round = x => x == null ? null : +x.toFixed(x >= 100 ? 2 : 4);

  const sinais = []; let score = 0;
  const push = (texto, sinal, peso = 1) => { sinais.push({ texto, sinal }); score += sinal === "alta" ? peso : sinal === "baixa" ? -peso : 0; };

  // Trend: price vs 50 and 200 (or 21 and 50 when there is not enough history).
  const [slow, fast, slowN, fastN] = m200[k] != null ? [m200, m50, 200, 50] : [m50, m21, 50, 21];
  let tendencia = "lateral";
  if (slow[k] != null && fast[k] != null) {
    if (C[k] > fast[k] && fast[k] > slow[k]) tendencia = "alta";
    else if (C[k] < fast[k] && fast[k] < slow[k]) tendencia = "baixa";
  }
  if (tendencia !== "lateral") push(`Tendência de ${tendencia}: preço ${tendencia === "alta" ? "acima" : "abaixo"} das médias de ${fastN} e ${slowN} ${f.label}`, tendencia, 2);

  const cruzamentos = [];
  const crosses = [
    [m9, m21, "MME 9 × MMS 21 (curto prazo)"],
    [m50, m200, null],
    [macd, sig, "MACD × linha de sinal"],
  ];
  for (const [a, bb, nome] of crosses) {
    const x = lastCross(a, bb, f.recent); if (!x) continue;
    const label = nome || (x.dir === "alta" ? "Golden cross (MMS 50 cruza acima da MMS 200)" : "Death cross (MMS 50 cruza abaixo da MMS 200)");
    cruzamentos.push({ nome: label, sinal: x.dir, data: date(x.i) });
    push(`${label} para ${x.dir} em ${date(x.i).split("-").reverse().join("/")}`, x.dir, a === m50 ? 2 : 1);
  }

  const ifr = r[k];
  if (ifr != null && ifr >= 70) push(`IFR(14) em ${ifr.toFixed(0)}: sobrecomprado`, "baixa");
  if (ifr != null && ifr <= 30) push(`IFR(14) em ${ifr.toFixed(0)}: sobrevendido`, "alta");

  if (sd[k] != null) {
    const top = bm[k] + 2 * sd[k], bot = bm[k] - 2 * sd[k];
    if (C[k] > top) push("Fechou acima da banda de Bollinger superior (esticado)", "neutro");
    if (C[k] < bot) push("Fechou abaixo da banda de Bollinger inferior (esticado)", "neutro");
  }

  const pats = patterns(b, f.trendMove);
  for (const p of pats) push(`Candle: ${p.nome} — ${p.descricao}`, p.sinal);

  if (frameKey === "diario") {
    const vAvg = b.slice(n - 21, n - 1).reduce((a, x) => a + x.v, 0) / 20;
    if (vAvg && b[k].v > 2 * vAvg) push(`Volume ${(b[k].v / vAvg).toFixed(1)}× a média de 20 pregões`, "neutro");
    const y = b.slice(-252), hi = Math.max(...y.map(x => x.h)), lo = Math.min(...y.map(x => x.l));
    if (C[k] >= hi * 0.98) push("Perto da máxima de 52 semanas", "neutro");
    if (C[k] <= lo * 1.02) push("Perto da mínima de 52 semanas", "neutro");
  }

  const last20 = b.slice(-20);
  return {
    data_ultimo_candle: date(k),
    fechamento: round(C[k]),
    tendencia,
    vies: score >= 2 ? "alta" : score <= -2 ? "baixa" : "neutro",
    pontuacao: score,
    medias: { mme9: round(m9[k]), mms21: round(m21[k]), mms50: round(m50[k]), mms200: round(m200[k]) },
    ifr14: ifr == null ? null : +ifr.toFixed(1),
    macd: macd[k] == null ? null : { macd: round(macd[k]), sinal: round(sig[k]), histograma: round(macd[k] - sig[k]) },
    suporte: round(Math.min(...last20.map(x => x.l))),
    resistencia: round(Math.max(...last20.map(x => x.h))),
    candles: pats,
    cruzamentos,
    sinais,
  };
}

const ind = JSON.parse(await readFile(new URL("indicadores.json", rel), "utf8"));
const ativos = {}, falhas = [];
const queue = [...ind.empresas];
async function worker() {
  while (queue.length) {
    const e = queue.shift();
    const sym = e.bolsa === "B3" ? e.ticker + ".SA" : e.ticker;
    try {
      const out = {};
      for (const [key, f] of Object.entries(FRAMES)) out[key] = analyze(await candles(sym, f), key);
      ativos[e.ticker] = out;
    } catch (err) { falhas.push(`${e.ticker}: ${err.message}`); }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
await writeFile(new URL("tecnica.json", rel), JSON.stringify({ data: today, fonte: "Yahoo Finance (candles)", ativos }, null, 1));
console.log(`Análise técnica: ${Object.keys(ativos).length} ativos.${falhas.length ? " Falhas: " + falhas.join("; ") : ""}`);
