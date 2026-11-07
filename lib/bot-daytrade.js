// One day of the simulated day trade, shared by scripts/bot.mjs (every closed day, at night) and
// bot.js (today, live in the browser while the market is open), so both apply exactly the same
// rules to the same 5-minute candles. No file or network access here.
import { ema } from "./analise.js";

export const iso = t => new Date(t * 1000).toISOString().slice(0, 10);
export const brt = t => new Date((t - 3 * 3600) * 1000).toISOString();            // Brasília (UTC−3, no summer time)
export const casas = m => m === "b3" ? 0 : m === "eua" ? 4 : 6;     // B3 shares are whole; US shares and crypto can be fractions
export const fmt = x => x.toLocaleString("pt-BR", { maximumSignificantDigits: 5 });
export const nfx = x => x.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

// A wallet: cash in reais, open positions, and the trade log. custos: fee per market; fx(mercado,
// date): reais per unit of the asset's currency; ativado: trades before it are marked "teste".
export function criarCarteira({ custos, fx, ativado }) {
  return function carteira(V0, inicial = {}) {
    const w = { caixa: inicial.caixa ?? V0, pos: new Map(), ops: inicial.ops || [] };
    w.patrimonio = d => w.caixa + [...w.pos.values()].reduce((s, p) => s + p.qtd * p.ultimo * fx(p.a.mercado, d), 0);
    w.comprar = (a, preco, d, motivo, max, extra = {}) => {
      if (w.pos.size >= max) return null;
      const taxa = custos[a.mercado], cambio = fx(a.mercado, d), pat = w.patrimonio(d);
      const alvo = Math.min(pat / max, w.caixa / (1 + taxa));
      const f = 10 ** casas(a.mercado), qtd = Math.floor(alvo / (preco * cambio) * f) / f, bruto = qtd * preco * cambio;
      if (qtd <= 0 || bruto < pat * 0.03) return null;
      const custo = bruto * taxa; w.caixa -= bruto + custo;
      const p = { a, qtd, preco, custo_brl: bruto + custo, data: d, ultimo: preco, ...extra };
      w.pos.set(a.ticker, p);
      w.ops.push({ data: d, ...(extra.hora ? { hora: extra.hora } : {}), ticker: a.ticker, nome: a.nome, mercado: a.mercado, lado: "compra", qtd, preco: +preco.toPrecision(6),
        valor_brl: +bruto.toFixed(2), custos_brl: +custo.toFixed(2), motivo, teste: d < ativado });
      return p;
    };
    w.vender = (a, preco, d, motivo, hora) => {
      const p = w.pos.get(a.ticker), bruto = p.qtd * preco * fx(a.mercado, d), custo = bruto * custos[a.mercado], res = bruto - custo - p.custo_brl;
      w.caixa += bruto - custo; w.pos.delete(a.ticker);
      w.ops.push({ data: d, ...(hora ? { hora } : {}), ticker: a.ticker, nome: a.nome, mercado: a.mercado, lado: "venda", qtd: p.qtd, preco: +preco.toPrecision(6), valor_brl: +bruto.toFixed(2),
        custos_brl: +custo.toFixed(2), motivo, resultado_brl: +res.toFixed(2), resultado_pct: +(res / p.custo_brl * 100).toFixed(2), comprado_em: p.data, teste: d < ativado });
    };
    return w;
  };
}

// Indicators of one asset over its 5-minute bars ({t, o, h, l, c, v}). fim[d] is the last bar of
// day d in the data and ultimoT[d] the time of the day's last bar; live, the caller replaces
// ultimoT[today] with the session's real last bar, which has not happened yet.
export function preparar(a, bars, R) {
  const C = bars.map(b => b.c), e9 = ema(C, 9), e21 = ema(C, 21);
  // day key: Brasília date for stocks, UTC date for crypto (its "day" closes at 21h in Brasília)
  const dia = bars.map(b => a.mercado === "cripto" ? iso(b.t) : brt(b.t).slice(0, 10));
  // VWAP of the day so far; crypto: average body of the previous candles
  const vwap = [], corpo = []; let pv = 0, vol = 0, soma = 0;
  bars.forEach((b, i) => {
    if (i === 0 || dia[i] !== dia[i - 1]) { pv = 0; vol = 0; }
    const tp = (b.h + b.l + b.c) / 3, v = b.v || 1; pv += tp * v; vol += v; vwap.push(pv / vol);
    soma += Math.abs(b.c - b.o); if (i >= R.dtc_media) soma -= Math.abs(bars[i - R.dtc_media].c - bars[i - R.dtc_media].o);
    corpo.push(i >= R.dtc_media ? soma / R.dtc_media : null);
  });
  // support and resistance before each bar: lowest low and highest high of the dt_sr_candles before
  // it; and the average volume of the dt_volume_n before it
  const N = R.dt_sr_candles || 20, NV = R.dt_volume_n || 20, sup = [], res = [], volMed = [];
  bars.forEach((b, i) => {
    if (i >= N) { let lo = Infinity, hi = -Infinity; for (let j = i - N; j < i; j++) { lo = Math.min(lo, bars[j].l); hi = Math.max(hi, bars[j].h); } sup.push(lo); res.push(hi); }
    else { sup.push(null); res.push(null); }
    if (i >= NV) { let s = 0; for (let j = i - NV; j < i; j++) s += bars[j].v || 0; volMed.push(s / NV); } else volMed.push(null);
  });
  const ini = {}, fim = {}, ultimoT = {};
  dia.forEach((d, i) => { ini[d] ??= i; fim[d] = i; ultimoT[d] = bars[i].t; });
  return { ...a, bars, e9, e21, dia, vwap, corpo, sup, res, volMed, ini, fim, ultimoT };
}

// The month's loss limit: the value below which the bot sells everything and stops until the next
// month. base: the patrimônio the month started with.
export const pisoDoMes = (base, R) => R.perda_mensal_pct > 0 ? base * (1 - R.perda_mensal_pct / 100) : -Infinity;
export const motivoLimite = R => `Limite de perda do mês atingido (−${nfx(R.perda_mensal_pct)}%)`;

// Simulates day d over the prepared assets. V: { caixa, ops } carried from the previous day.
// piso: the month's loss limit (pisoDoMes); once crossed, w.travado is set and nothing more is done.
// aoVivo: the day is not over, so whatever is still open stays open (w.pos) and the orders for the
// next bar stay pending; otherwise anything left open by a gap in the data is closed at its last price.
export function simularDia(d, dados, { carteira, V0, V, R, deslize, aoVivo = false, piso = -Infinity }) {
  const w = carteira(V0, V), pend = new Map();
  // the limit was hit on an earlier day of the month: no trading until the month changes
  if (w.caixa <= piso) { w.travado = true; if (aoVivo) w.pendentes = []; return w; }
  // every 5-minute bar of the day, of every asset, in time order
  const fila = dados.flatMap(a => a.ini[d] == null ? [] : Array.from({ length: a.fim[d] - a.ini[d] + 1 }, (_, j) => [a, a.ini[d] + j]))
    .sort((x, y) => x[0].bars[x[1]].t - y[0].bars[y[1]].t || x[0].ticker.localeCompare(y[0].ticker));
  for (const [a, i] of fila) {
    const b = a.bars[i], hora = brt(b.t).slice(11, 16), cripto = a.mercado === "cripto", ultimo = b.t >= a.ultimoT[d];
    const sell = (preco, motivo) => w.vender(a, preco * (1 - deslize), d, motivo, hora);
    // 1. pending order of the previous bar, at this bar's open
    const o = pend.get(a.ticker); pend.delete(a.ticker);
    if (o?.lado === "venda" && w.pos.has(a.ticker)) sell(b.o, o.motivo);
    if (o?.lado === "compra" && !w.pos.has(a.ticker)) {
      const preco = b.o * (1 + deslize);
      const stop = cripto ? o.stop : preco * (1 - R.dt_stop_pct / 100);
      const alvo = cripto ? preco + R.dtc_rr * (preco - stop) : preco * (1 + R.dt_alvo_pct / 100);
      // selling at the resistance: the one of the signal candle, if it is above the purchase price
      const resist = !cripto && R.dt_vender_resistencia && o.resist > preco ? o.resist : null;
      if (stop < preco) { const p = w.comprar(a, preco, d, o.motivo, R.dt_max_posicoes, { hora, stop, alvo, resist, barras: 0 }); if (p) p.ultimo = b.c; }
    }
    // 2. during the bar: stop first (the cautious assumption when both are touched), then target
    const p = w.pos.get(a.ticker);
    if (p) {
      p.barras++;
      if (b.o <= p.stop) sell(b.o, `Stop: abriu abaixo de ${fmt(p.stop)}`);
      else if (b.l <= p.stop) sell(p.stop, `Stop: tocou ${fmt(p.stop)}`);
      else if (p.resist && p.resist < p.alvo && b.o >= p.resist) sell(b.o, `Resistência: abriu acima de ${fmt(p.resist)}`);
      else if (p.resist && p.resist < p.alvo && b.h >= p.resist) sell(p.resist, `Resistência atingida: ${fmt(p.resist)}`);
      else if (b.o >= p.alvo) sell(b.o, `Alvo: abriu acima de ${fmt(p.alvo)}`);
      else if (b.h >= p.alvo) sell(p.alvo, `Alvo atingido: ${fmt(p.alvo)}`);
      else {
        p.ultimo = b.c;
        const resta = (a.ultimoT[d] - b.t) / 60;      // minutes from this bar to the day's last bar
        if (ultimo || (!cripto && resta < R.dt_zerar_min)) sell(b.c, cripto ? "Zerado no fim do dia (21h)" : "Zerado antes do fechamento");
        else if (cripto && p.barras >= R.dtc_max_candles) sell(b.c, `Tempo máximo (${R.dtc_max_candles} candles de 5 min)`);
        else if (!cripto && R.dt_sair_cruzamento && a.e9[i - 1] >= a.e21[i - 1] && a.e9[i] < a.e21[i]) pend.set(a.ticker, { lado: "venda", motivo: "MME 9 cruzou abaixo da MME 21 (5 min)" });
      }
    }
    // the month's loss limit: sell everything at the latest prices and stop
    if (w.patrimonio(d) <= piso) {
      for (const q of [...w.pos.values()]) w.vender(q.a, q.ultimo * (1 - deslize), d, motivoLimite(R), hora);
      w.travado = true; pend.clear(); break;
    }
    // 3. at the close of the bar: a new entry for the next bar?
    if (w.pos.has(a.ticker) || ultimo) continue;
    // the volume filter: the signal candle must trade more than the recent average
    const vm = a.volMed[i], volOk = !R.dt_volume || (vm > 0 && b.v > vm);
    const volTxt = R.dt_volume && vm > 0 ? `, volume ${nfx(b.v / vm)}× a média` : "";
    if (!volOk) continue;
    if (cripto) {
      const corpo = b.c - b.o, media = a.corpo[i - 1];
      if (corpo > 0 && media > 0 && corpo >= R.dtc_mult * media)
        pend.set(a.ticker, { lado: "compra", stop: b.l, motivo: `Candle de alta ${nfx(corpo / media)}× maior que a média dos últimos ${R.dtc_media}${volTxt}` });
    } else {
      const desde = (b.t - a.bars[a.ini[d]].t) / 60 + 5, resta = (a.ultimoT[d] - b.t) / 60;
      if (desde >= R.dt_inicio_min && resta >= R.dt_ultima_min) {
        const cruz = R.dt_comprar_cruzamento && a.e9[i - 1] != null && a.e9[i - 1] <= a.e21[i - 1] && a.e9[i] > a.e21[i] && (!R.dt_vwap || b.c > a.vwap[i]);
        const sup = R.dt_comprar_suporte && a.sup[i] != null && b.l <= a.sup[i] && b.c >= a.sup[i];
        if (cruz) pend.set(a.ticker, { lado: "compra", resist: a.res[i], motivo: `MME 9 cruzou acima da MME 21 (5 min)${R.dt_vwap ? ", preço acima da VWAP" : ""}${volTxt}` });
        else if (sup) pend.set(a.ticker, { lado: "compra", resist: a.res[i], motivo: `Tocou o suporte (${fmt(a.sup[i])}, mínima dos ${R.dt_sr_candles} candles anteriores) e fechou acima dele${volTxt}` });
      }
    }
  }
  if (aoVivo) w.pendentes = [...pend].map(([ticker, o]) => ({ ticker, ...o }));
  // a gap in the data can leave something open: closed at its last price
  else for (const p of [...w.pos.values()]) w.vender(p.a, p.ultimo, d, "Zerado no fim do dia (sem mais candles)");
  return w;
}
