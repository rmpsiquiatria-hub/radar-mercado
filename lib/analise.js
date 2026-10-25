// Technical-analysis building blocks shared by the site's charts (loaded as an ES module
// into window.Analise) and by scripts/tecnica.mjs (report and e-mail), so both read the
// same averages, oscillators and candlestick patterns.
// Bars are {t, o, h, l, c, v}; series functions return arrays aligned with the input (null until defined).

export const sma = (xs, n) => xs.map((_, i) => i + 1 < n ? null : xs.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n);

export function ema(xs, n) {
  const k = 2 / (n + 1), out = []; let prev = null;
  xs.forEach((x, i) => {
    if (x == null || i + 1 < n) { out.push(null); return; }
    prev = prev == null ? xs.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n : x * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

export function rsi(xs, n = 14) {
  const out = Array(xs.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) out[i] = l ? 100 - 100 / (1 + g / l) : 100; continue; }
    g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
    out[i] = l ? 100 - 100 / (1 + g / l) : 100;
  }
  return out;
}

export function macd(xs, fast = 12, slow = 26, signal = 9) {
  const ef = ema(xs, fast), es = ema(xs, slow);
  const line = xs.map((_, i) => ef[i] != null && es[i] != null ? ef[i] - es[i] : null);
  const start = line.findIndex(x => x != null);
  const sig = start < 0 ? line.map(() => null) : Array(start).fill(null).concat(ema(line.slice(start), signal));
  return { line, signal: sig, hist: line.map((x, i) => x != null && sig[i] != null ? x - sig[i] : null) };
}

export function bollinger(xs, n = 20, k = 2) {
  const m = sma(xs, n);
  const sd = xs.map((_, i) => m[i] == null ? null : Math.sqrt(xs.slice(i + 1 - n, i + 1).reduce((a, x) => a + (x - m[i]) ** 2, 0) / n));
  return { mid: m, upper: m.map((x, i) => x == null ? null : x + k * sd[i]), lower: m.map((x, i) => x == null ? null : x - k * sd[i]) };
}

// Last bar index (within the last `recent` bars) where series a crossed series b.
export function lastCross(a, b, recent) {
  for (let i = a.length - 1; i >= Math.max(1, a.length - recent); i--) {
    if ([a[i], b[i], a[i - 1], b[i - 1]].some(x => x == null)) continue;
    if (a[i - 1] <= b[i - 1] && a[i] > b[i]) return { i, dir: "alta" };
    if (a[i - 1] >= b[i - 1] && a[i] < b[i]) return { i, dir: "baixa" };
  }
  return null;
}

// Support/resistance: lowest low and highest high of the last `n` bars up to index k.
export function supportResistance(bars, n = 20, k = bars.length - 1) {
  const w = bars.slice(Math.max(0, k + 1 - n), k + 1);
  return { suporte: Math.min(...w.map(x => x.l)), resistencia: Math.max(...w.map(x => x.h)) };
}

// Candlestick reversal patterns that complete at bar k. `move` is the price change over the
// 5 bars before the pattern that counts as a prior trend (e.g. 0.02 daily, 0.04 weekly).
export function patternsAt(b, k, move) {
  if (k < 7 || k >= b.length) return [];
  const P = [];
  const body = x => Math.abs(x.c - x.o), rng = x => x.h - x.l || 1e-9;
  const up = x => x.c > x.o, dn = x => x.c < x.o;
  const upper = x => x.h - Math.max(x.o, x.c), lower = x => Math.min(x.o, x.c) - x.l;
  const trendBefore = i => { if (i < 6) return "lateral"; const ch = b[i - 1].c / b[i - 6].c - 1; return ch > move ? "alta" : ch < -move ? "baixa" : "lateral"; };
  const avgBody = b.slice(Math.max(0, k - 10), k).reduce((a, x) => a + body(x), 0) / Math.min(10, k) || 1e-9;
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
