// Candle download and technical analysis per timeframe, shared by scripts/tecnica.mjs (report and
// e-mail) and scripts/bot.mjs (simulated trading bot), so both read the same signals.
import { sma, ema, rsi, macd as macdCalc, bollinger, lastCross, patternsAt, supportResistance } from "../lib/analise.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

// Per timeframe: Yahoo range/interval, how many recent bars count as "recent" for a crossover,
// and the move that defines the trend before a candle pattern.
export const FRAMES = {
  diario: { range: "2y", interval: "1d", recent: 5, trendMove: 0.02, label: "pregões" },
  semanal: { range: "10y", interval: "1wk", recent: 3, trendMove: 0.04, label: "semanas" },
  mensal: { range: "20y", interval: "1mo", recent: 2, trendMove: 0.06, label: "meses" },
};

export async function candles(symbol, { range, interval }) {
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
export function closedOnly(bars, frame) {
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

// Analysis of the last bar of b, which must contain closed bars only. mm: the four averages as
// [mme | mms, period] (the bot's rules can change them; the report uses the defaults).
const MM_PADRAO = { curta: ["mme", 9], media: ["mms", 21], rapida: ["mms", 50], lenta: ["mms", 200] };
const nomeMM = ([t, p]) => `${t === "mme" ? "MME" : "MMS"} ${p}`;
export function analisar(b, frameKey, mm = MM_PADRAO) {
  const f = FRAMES[frameKey];
  if (b.length < 30) return null;
  const C = b.map(x => x.c), n = C.length, k = n - 1, calc = ([t, p]) => t === "mme" ? ema(C, p) : sma(C, p);
  const m9 = calc(mm.curta), m21 = calc(mm.media), m50 = calc(mm.rapida), m200 = calc(mm.lenta);
  const [nC, nM, nR, nL] = [mm.curta, mm.media, mm.rapida, mm.lenta].map(nomeMM);
  const r = rsi(C), { line: macd, signal: sig } = macdCalc(C), bb = bollinger(C);
  const date = i => new Date(b[i].t * 1000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const round = x => x == null ? null : +x.toFixed(x >= 100 ? 2 : 4);

  const sinais = []; let score = 0;
  const push = (texto, sinal, peso = 1) => { sinais.push({ texto, sinal }); score += sinal === "alta" ? peso : sinal === "baixa" ? -peso : 0; };

  // Trend: price vs 50 and 200 (or 21 and 50 when there is not enough history).
  const [slow, fast, slowN, fastN] = m200[k] != null ? [m200, m50, mm.lenta[1], mm.rapida[1]] : [m50, m21, mm.rapida[1], mm.media[1]];
  let tendencia = "lateral";
  if (slow[k] != null && fast[k] != null) {
    if (C[k] > fast[k] && fast[k] > slow[k]) tendencia = "alta";
    else if (C[k] < fast[k] && fast[k] < slow[k]) tendencia = "baixa";
  }
  if (tendencia !== "lateral") push(`Tendência de ${tendencia}: preço ${tendencia === "alta" ? "acima" : "abaixo"} das médias de ${fastN} e ${slowN} ${f.label}`, tendencia, 2);

  const cruzamentos = [];
  const crosses = [
    [m9, m21, `${nC} × ${nM} (curto prazo)`],
    [m50, m200, null],
    [macd, sig, "MACD × linha de sinal"],
  ];
  for (const [a, bb, nome] of crosses) {
    const x = lastCross(a, bb, f.recent); if (!x) continue;
    const label = nome || (x.dir === "alta" ? `Golden cross (${nR} cruza acima da ${nL})` : `Death cross (${nR} cruza abaixo da ${nL})`);
    cruzamentos.push({ nome: label, sinal: x.dir, data: date(x.i) });
    push(`${label} para ${x.dir} em ${date(x.i).split("-").reverse().join("/")}`, x.dir, a === m50 ? 2 : 1);
  }

  const ifr = r[k];
  if (ifr != null && ifr >= 70) push(`IFR(14) em ${ifr.toFixed(0)}: sobrecomprado`, "baixa");
  if (ifr != null && ifr <= 30) push(`IFR(14) em ${ifr.toFixed(0)}: sobrevendido`, "alta");

  if (bb.upper[k] != null) {
    const top = bb.upper[k], bot = bb.lower[k];
    if (C[k] > top) push("Fechou acima da banda de Bollinger superior (esticado)", "neutro");
    if (C[k] < bot) push("Fechou abaixo da banda de Bollinger inferior (esticado)", "neutro");
  }

  const pats = patternsAt(b, k, f.trendMove);
  for (const p of pats) push(`Candle: ${p.nome} — ${p.descricao}`, p.sinal);

  if (frameKey === "diario") {
    const vAvg = b.slice(n - 21, n - 1).reduce((a, x) => a + x.v, 0) / 20;
    if (vAvg && b[k].v > 2 * vAvg) push(`Volume ${(b[k].v / vAvg).toFixed(1)}× a média de 20 pregões`, "neutro");
    const y = b.slice(-252), hi = Math.max(...y.map(x => x.h)), lo = Math.min(...y.map(x => x.l));
    if (C[k] >= hi * 0.98) push("Perto da máxima de 52 semanas", "neutro");
    if (C[k] <= lo * 1.02) push("Perto da mínima de 52 semanas", "neutro");
  }

  const sr = supportResistance(b, 20, k);
  return {
    data_ultimo_candle: date(k),
    fechamento: round(C[k]),
    tendencia,
    vies: score >= 2 ? "alta" : score <= -2 ? "baixa" : "neutro",
    pontuacao: score,
    medias: { mme9: round(m9[k]), mms21: round(m21[k]), mms50: round(m50[k]), mms200: round(m200[k]) },
    ifr14: ifr == null ? null : +ifr.toFixed(1),
    macd: macd[k] == null ? null : { macd: round(macd[k]), sinal: round(sig[k]), histograma: round(macd[k] - sig[k]) },
    suporte: round(sr.suporte),
    resistencia: round(sr.resistencia),
    candles: pats,
    cruzamentos,
    sinais,
  };
}

export const analyze = (bars, frameKey) => analisar(closedOnly(bars, frameKey), frameKey);
