// Simulated trading bot (technical analysis only, imaginary money). Reads the user's choice from
// relatorios/config.json → bot: { valor_inicial, modos: ["diario", "semanal", "daytrade"], ativado_em,
// regras } (the rules and their defaults are in lib/bot-regras.js) and writes the portfolio, the trade
// history and the scoreboard of each mode to relatorios/bot/resultado.json.
// Daily and weekly: every closed candle from 12 months before ativado_em to today is replayed on
// every run; the replay is deterministic, so the same candles always give the same trades and a
// missed or late run loses nothing.
// Day trade: Yahoo keeps 5-minute candles for only ~60 days, so each closed day is simulated once
// and kept in relatorios/bot/daytrade/ (estado.json: the cash and the result of each day; one
// ops-AAAA-MM.json per month with that month's trades, so only the current month is rewritten);
// changing the value or the rules starts it over from the days still available.
// Trades before ativado_em are marked "teste" (back test); the ones after it are the bot running live.
// Run: node scripts/bot.mjs

import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { FRAMES, candles, closedOnly, analisar } from "./tecnica-lib.mjs";
import { ema } from "../lib/analise.js";
import { normalizar } from "../lib/bot-regras.js";

const rel = new URL("../relatorios/", import.meta.url);
const cfg = JSON.parse(await readFile(new URL("config.json", rel), "utf8")).bot;
if (!cfg?.valor_inicial || !cfg.modos?.length) { console.log("Bot não configurado (escolha o valor e o modo no site)."); process.exit(0); }
const R = normalizar(cfg.regras);
// Not configurable: what each trade costs, and how far back the test goes.
const FIXOS = {
  custos: { b3: 0.0003, eua: 0.001, cripto: 0.001 },   // fees per trade (share of the value)
  deslize: 0.0005,          // execution 0.05% worse than the price that triggered it (spread / slippage)
  historico_meses: 12,      // back test before the activation date
};
const CRIPTO = [["BTC-USD", "Bitcoin"], ["ETH-USD", "Ethereum"], ["SOL-USD", "Solana"], ["XRP-USD", "XRP"], ["BNB-USD", "BNB"]];

const ind = JSON.parse(await readFile(new URL("indicadores.json", rel), "utf8"));
const universo = [
  ...ind.empresas.map(e => ({ ticker: e.ticker, nome: e.nome, mercado: e.bolsa === "B3" ? "b3" : "eua", sym: e.bolsa === "B3" ? e.ticker + ".SA" : e.ticker, peso: e.peso_ibov || 0 })),
  ...CRIPTO.map(([sym, nome]) => ({ ticker: sym.replace("-USD", ""), nome, mercado: "cripto", sym, peso: 0 })),
].filter(a => R.mercados.includes(a.mercado));

const iso = t => new Date(t * 1000).toISOString().slice(0, 10);
const brt = t => new Date((t - 3 * 3600) * 1000).toISOString();            // Brasília (UTC−3, no summer time)
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hoje = brt(Date.now() / 1000).slice(0, 10);
const ativado = cfg.ativado_em || hoje;
const inicio = (() => { const x = new Date(ativado + "T12:00:00Z"); x.setUTCMonth(x.getUTCMonth() - FIXOS.historico_meses); return x.toISOString().slice(0, 10); })();
const casas = m => m === "b3" ? 0 : m === "eua" ? 4 : 6;     // B3 shares are whole; US shares and crypto can be fractions
const fmt = x => x.toLocaleString("pt-BR", { maximumSignificantDigits: 5 });

// Crypto trades around the clock: a bar is closed only when its whole period has passed.
function fechados(bars, frame, mercado) {
  if (mercado !== "cripto") return closedOnly(bars, frame);
  const span = frame === "semanal" ? 7 * 86400 : 86400, now = Date.now() / 1000;
  return bars.filter(b => b.t + span <= now);
}
function atrSerie(b, n = 14) {
  const out = []; let a = null;
  b.forEach((x, i) => {
    const tr = i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l;
    a = i < n ? (a == null ? tr : a + (tr - a) / (i + 1)) : a + (tr - a) / n;
    out.push(a);
  });
  return out;
}
// Same reading as the e-mail: crossovers (without MACD) and reversal candles.
const eventos = s => [...s.cruzamentos.filter(c => !/MACD/.test(c.nome)).map(c => c.sinal), ...s.candles.map(c => c.sinal)];
const conflito = s => R.evitar_conflito && eventos(s).includes("alta") && eventos(s).includes("baixa");
const motivoDe = (s, lado) => s.sinais.filter(x => x.sinal === lado).slice(0, 2).map(x => x.texto).join("; ");

async function pool(items, fn, n = 6) {
  const q = [...items], out = [];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) { const it = q.shift(); try { out.push(await fn(it)); } catch (e) { console.error(it.ticker || it, e.message); } } }));
  // downloads finish in any order: a fixed order keeps the replay identical from run to run
  return out.sort((x, y) => x.ticker.localeCompare(y.ticker));
}

// Benchmarks and currency: Ibovespa and the dollar (daily), CDI from the Central Bank.
const serie = async sym => closedOnly(await candles(sym, FRAMES.diario), "diario").map(b => [iso(b.t), b.c]);
const ultimoAte = (s, d) => { let lo = 0, hi = s.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m][0] <= d) { r = s[m][1]; lo = m + 1; } else hi = m - 1; } return r; };
const [ibov, dolar] = await Promise.all([serie("^BVSP"), serie("BRL=X")]);
let cdi = null;
try {
  const br = d => d.split("-").reverse().join("/");
  const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${br(inicio)}&dataFinal=${br(hoje)}`);
  let acc = 1; cdi = (await r.json()).map(x => { acc *= 1 + parseFloat(x.valor) / 100; return [x.data.split("/").reverse().join("-"), acc]; });
} catch (e) { console.error("CDI:", e.message); }
const fx = (m, d) => m === "b3" ? 1 : ultimoAte(dolar, d) || ultimoAte(dolar, addDays(d, 7));

// A wallet: cash in reais, open positions, and the trade log (shared by every mode).
function carteira(V0, inicial = {}) {
  const w = { caixa: inicial.caixa ?? V0, pos: new Map(), ops: inicial.ops || [] };
  w.patrimonio = d => w.caixa + [...w.pos.values()].reduce((s, p) => s + p.qtd * p.ultimo * fx(p.a.mercado, d), 0);
  w.comprar = (a, preco, d, motivo, max, extra = {}) => {
    if (w.pos.size >= max) return null;
    const taxa = FIXOS.custos[a.mercado], cambio = fx(a.mercado, d), pat = w.patrimonio(d);
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
    const p = w.pos.get(a.ticker), bruto = p.qtd * preco * fx(a.mercado, d), custo = bruto * FIXOS.custos[a.mercado], res = bruto - custo - p.custo_brl;
    w.caixa += bruto - custo; w.pos.delete(a.ticker);
    w.ops.push({ data: d, ...(hora ? { hora } : {}), ticker: a.ticker, nome: a.nome, mercado: a.mercado, lado: "venda", qtd: p.qtd, preco: +preco.toPrecision(6), valor_brl: +bruto.toFixed(2),
      custos_brl: +custo.toFixed(2), motivo, resultado_brl: +res.toFixed(2), resultado_pct: +(res / p.custo_brl * 100).toFixed(2), comprado_em: p.data, teste: d < ativado });
  };
  return w;
}
const bench = (curva0, V0, d) => {
  const i0 = ultimoAte(ibov, curva0), c0 = cdi && ultimoAte(cdi, curva0);
  return [i0 ? +(V0 * ultimoAte(ibov, d) / i0).toFixed(2) : null, c0 ? +(V0 * ultimoAte(cdi, d) / c0).toFixed(2) : null];
};
function placar(curva, ops, V0) {
  const fim = curva.at(-1)?.[1] ?? V0, ultimo = curva.at(-1);
  let topo = -Infinity, dd = 0; for (const [, v] of curva) { topo = Math.max(topo, v); dd = Math.min(dd, v / topo - 1); }
  const vendas = ops.filter(o => o.lado === "venda"), ganhos = vendas.filter(o => o.resultado_brl > 0), perdas = vendas.filter(o => o.resultado_brl <= 0);
  const media = l => l.length ? +(l.reduce((s, o) => s + o.resultado_pct, 0) / l.length).toFixed(2) : null;
  const pctDe = (a, b) => a && b ? +((a / b - 1) * 100).toFixed(2) : null;
  const naAtivacao = curva.filter(c => c[0] < ativado).at(-1);
  return {
    retorno_pct: pctDe(fim, V0), ibov_pct: pctDe(ultimo?.[2], V0), cdi_pct: pctDe(ultimo?.[3], V0),
    ao_vivo_pct: naAtivacao && ultimo[0] >= ativado ? pctDe(fim, naAtivacao[1]) : null,
    queda_maxima_pct: +(dd * 100).toFixed(2), operacoes: vendas.length,
    acerto_pct: vendas.length ? +(ganhos.length / vendas.length * 100).toFixed(1) : null,
    ganho_medio_pct: media(ganhos), perda_media_pct: media(perdas),
    custos_brl: +ops.reduce((s, o) => s + o.custos_brl, 0).toFixed(2),
  };
}

/* ---------- daily and weekly charts ---------- */
function simular(frame, dados) {
  const V0 = cfg.valor_inicial, semanal = frame === "semanal", MAX = R.max_posicoes, ESPERA = R[`espera_${frame}`];
  // value date: a weekly bar is stamped on Monday and closes on Friday
  const vd = d => semanal ? addDays(d, 4) : d;
  const idx = new Map(dados.map(a => [a.ticker, new Map(a.bars.map((b, i) => [iso(b.t), i]))]));
  const datas = [...new Set(dados.flatMap(a => a.bars.map(b => iso(b.t))))].filter(d => d >= inicio).sort();
  const w = carteira(V0), pend = new Map(), espera = new Map(), curva = [];
  const vender = (a, preco, d, motivo) => { w.vender(a, preco, d, motivo); espera.set(a.ticker, idx.get(a.ticker).get(d) + ESPERA); };

  for (const d of datas) {
    const hojeA = dados.filter(a => idx.get(a.ticker).has(d));
    const bar = a => a.bars[idx.get(a.ticker).get(d)];
    // 1. at the open: sales first (they free money), then purchases by score
    for (const a of hojeA) if (pend.get(a.ticker)?.lado === "venda") { if (w.pos.has(a.ticker)) vender(a, bar(a).o * (1 - FIXOS.deslize), d, pend.get(a.ticker).motivo); pend.delete(a.ticker); }
    const compras = hojeA.filter(a => pend.get(a.ticker)?.lado === "compra").sort((x, y) => pend.get(y.ticker).score - pend.get(x.ticker).score || x.ticker.localeCompare(y.ticker));
    for (const a of compras) {
      const o = pend.get(a.ticker); pend.delete(a.ticker);
      const preco = bar(a).o * (1 + FIXOS.deslize);
      const p = w.comprar(a, preco, d, o.motivo, MAX, { stop: preco - R.stop_atr * o.atr });
      if (p) p.ultimo = bar(a).c;
    }
    // 2. during the bar: the stop
    for (const a of hojeA) {
      const p = w.pos.get(a.ticker); if (!p) continue;
      const b = bar(a);
      if (b.o <= p.stop) vender(a, b.o * (1 - FIXOS.deslize), d, `Stop: abriu abaixo do preço de proteção (${fmt(p.stop)})`);
      else if (b.l <= p.stop) vender(a, p.stop * (1 - FIXOS.deslize), d, `Stop: tocou o preço de proteção (${fmt(p.stop)})`);
    }
    // 3. at the close: update prices and stops, then decide what to do at the next open
    for (const a of hojeA) {
      const i = idx.get(a.ticker).get(d), b = a.bars[i], s = a.sinais[i], p = w.pos.get(a.ticker);
      if (p) { p.ultimo = b.c; if (R.trailing_atr > 0) p.stop = Math.max(p.stop, b.c - R.trailing_atr * a.atr[i]); }
      if (!s) continue;
      if (p) {
        if (R.vender_tendencia && s.tendencia === "baixa") pend.set(a.ticker, { lado: "venda", motivo: `Tendência virou de baixa: ${motivoDe(s, "baixa")}` });
        else if (R.vender_vies && s.vies === "baixa" && !conflito(s)) pend.set(a.ticker, { lado: "venda", motivo: `Viés de baixa (pontuação ${s.pontuacao}): ${motivoDe(s, "baixa")}` });
      } else if (s.pontuacao >= R.pontuacao_min && s.tendencia !== "baixa" && !conflito(s) && i >= (espera.get(a.ticker) ?? 0)) {
        pend.set(a.ticker, { lado: "compra", score: s.pontuacao, atr: a.atr[i], motivo: `Viés de alta (pontuação +${s.pontuacao}): ${motivoDe(s, "alta")}` });
      } else if (pend.get(a.ticker)?.lado === "compra") pend.delete(a.ticker);
    }
    const v = vd(d);
    curva.push([v, +w.patrimonio(v).toFixed(2), ...bench(vd(datas[0]), V0, v)]);
  }

  const ultimo = curva.at(-1);
  return {
    inicio, ativado_em: ativado, valor_inicial: V0, ultimo_candle: ultimo?.[0] || null,
    patrimonio: ultimo?.[1] ?? V0, caixa: +w.caixa.toFixed(2), placar: placar(curva, w.ops, V0),
    posicoes: [...w.pos.values()].map(p => {
      const valor = p.qtd * p.ultimo * fx(p.a.mercado, ultimo[0]);
      return { ticker: p.a.ticker, nome: p.a.nome, mercado: p.a.mercado, qtd: p.qtd, preco_compra: +p.preco.toPrecision(6), preco_atual: +p.ultimo.toPrecision(6), comprado_em: p.data,
        valor_brl: +valor.toFixed(2), resultado_pct: +((valor / p.custo_brl - 1) * 100).toFixed(2), stop: +p.stop.toPrecision(5) };
    }).sort((x, y) => y.valor_brl - x.valor_brl),
    // orders for the next open: every sale, and the purchases that fit in the free slots (best score first)
    pendentes: (() => {
      const l = [...pend.entries()].map(([t, o]) => { const a = dados.find(x => x.ticker === t); return { ticker: t, nome: a.nome, mercado: a.mercado, lado: o.lado, motivo: o.motivo, score: o.score || 0 }; });
      const v = l.filter(o => o.lado === "venda"), livres = MAX - w.pos.size + v.length;
      return [...v, ...l.filter(o => o.lado === "compra").sort((a, b) => b.score - a.score).slice(0, Math.max(0, livres))].map(({ score, ...o }) => o);
    })(),
    operacoes: [...w.ops].reverse(),
    curva,
  };
}

/* ---------- day trade on 5-minute candles ---------- */
// Stocks: buys when the 9-period average crosses above the 21-period one (above the VWAP, if chosen),
// sells at the target, at the stop, when the averages cross back down, or before the close.
// Crypto: buys after a rising candle much bigger than the recent ones; stop at that candle's low,
// target a multiple of the risk, and a time limit. Nothing is held overnight (crypto: past 21h).
async function daytrade() {
  const V0 = cfg.valor_inicial, pasta = new URL("bot/daytrade/", rel), arq = new URL("estado.json", pasta);
  const chave = JSON.stringify([V0, ativado, R.mercados, ...Object.entries(R).filter(([k]) => k.startsWith("dt"))]);
  let est = null; try { est = JSON.parse(await readFile(arq, "utf8")); } catch {}
  if (est?.chave !== chave) { est = { chave, dias: [], caixa: V0, placar: null }; await rm(pasta, { recursive: true, force: true }); }
  await mkdir(pasta, { recursive: true });
  const mesArq = m => new URL(`ops-${m}.json`, pasta);
  const meses = (await readdir(pasta)).filter(f => /^ops-\d{4}-\d{2}\.json$/.test(f)).map(f => f.slice(4, 11)).sort();
  // the scoreboard needs every trade: read them all (small: one month is a few hundred kB)
  const todas = [];
  for (const m of meses) todas.push(...JSON.parse(await readFile(mesArq(m), "utf8")));

  // B3: only the most liquid (largest weight in the Ibovespa); every chosen US stock; every crypto
  const b3 = universo.filter(a => a.mercado === "b3").sort((x, y) => y.peso - x.peso).slice(0, R.dt_b3_top);
  const ativos = [...b3, ...universo.filter(a => a.mercado !== "b3")];
  const dados = await pool(ativos, async a => {
    const bars = await candles(a.sym, { range: "60d", interval: "5m" });
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
    // first and last bar of each day
    const ini = {}, fim = {}; dia.forEach((d, i) => { ini[d] ??= i; fim[d] = i; });
    return { ...a, bars, e9, e21, dia, vwap, corpo, ini, fim };
  });
  if (!dados.length) throw new Error("sem candles de 5 minutos");

  // a day is closed once crypto's UTC day has ended (21h in Brasília); the bot runs at 21h30
  const agora = Date.now() / 1000, fechouHoje = (agora - 3 * 3600) % 86400 >= 21 * 3600;
  const ultimoDia = fechouHoje ? hoje : addDays(hoje, -1);
  const feitos = new Set(est.dias.map(x => x[0]));
  const dias = [...new Set(dados.flatMap(a => Object.keys(a.ini)))].filter(d => d >= inicio && d <= ultimoDia && !feitos.has(d) && d > (est.dias.at(-1)?.[0] || "")).sort();
  const novas = [], V = { caixa: est.caixa, ops: novas };

  for (const d of dias) {
    const w = carteira(V0, V), pend = new Map();
    // every 5-minute bar of the day, of every asset, in time order
    const fila = dados.flatMap(a => a.ini[d] == null ? [] : Array.from({ length: a.fim[d] - a.ini[d] + 1 }, (_, j) => [a, a.ini[d] + j]))
      .sort((x, y) => x[0].bars[x[1]].t - y[0].bars[y[1]].t || x[0].ticker.localeCompare(y[0].ticker));
    for (const [a, i] of fila) {
      const b = a.bars[i], hora = brt(b.t).slice(11, 16), cripto = a.mercado === "cripto";
      const sell = (preco, motivo) => w.vender(a, preco * (1 - FIXOS.deslize), d, motivo, hora);
      // 1. pending order of the previous bar, at this bar's open
      const o = pend.get(a.ticker); pend.delete(a.ticker);
      if (o?.lado === "venda" && w.pos.has(a.ticker)) sell(b.o, o.motivo);
      if (o?.lado === "compra" && !w.pos.has(a.ticker)) {
        const preco = b.o * (1 + FIXOS.deslize);
        const stop = cripto ? o.stop : preco * (1 - R.dt_stop_pct / 100);
        const alvo = cripto ? preco + R.dtc_rr * (preco - stop) : preco * (1 + R.dt_alvo_pct / 100);
        if (stop < preco) { const p = w.comprar(a, preco, d, o.motivo, R.dt_max_posicoes, { hora, stop, alvo, barras: 0 }); if (p) p.ultimo = b.c; }
      }
      // 2. during the bar: stop first (the cautious assumption when both are touched), then target
      const p = w.pos.get(a.ticker);
      if (p) {
        p.barras++;
        if (b.o <= p.stop) sell(b.o, `Stop: abriu abaixo de ${fmt(p.stop)}`);
        else if (b.l <= p.stop) sell(p.stop, `Stop: tocou ${fmt(p.stop)}`);
        else if (b.o >= p.alvo) sell(b.o, `Alvo: abriu acima de ${fmt(p.alvo)}`);
        else if (b.h >= p.alvo) sell(p.alvo, `Alvo atingido: ${fmt(p.alvo)}`);
        else {
          p.ultimo = b.c;
          const resta = (a.bars[a.fim[d]].t - b.t) / 60;      // minutes from this bar to the day's last bar
          if (i === a.fim[d] || (!cripto && resta < R.dt_zerar_min)) sell(b.c, cripto ? "Zerado no fim do dia (21h)" : "Zerado antes do fechamento");
          else if (cripto && p.barras >= R.dtc_max_candles) sell(b.c, `Tempo máximo (${R.dtc_max_candles} candles de 5 min)`);
          else if (!cripto && a.e9[i - 1] >= a.e21[i - 1] && a.e9[i] < a.e21[i]) pend.set(a.ticker, { lado: "venda", motivo: "MME 9 cruzou abaixo da MME 21 (5 min)" });
        }
      }
      // 3. at the close of the bar: a new entry for the next bar?
      if (w.pos.has(a.ticker) || i >= a.fim[d]) continue;
      if (cripto) {
        const corpo = b.c - b.o, media = a.corpo[i - 1];
        if (corpo > 0 && media > 0 && corpo >= R.dtc_mult * media)
          pend.set(a.ticker, { lado: "compra", stop: b.l, motivo: `Candle de alta ${nfx(corpo / media)}× maior que a média dos últimos ${R.dtc_media}` });
      } else {
        const desde = (b.t - a.bars[a.ini[d]].t) / 60 + 5, resta = (a.bars[a.fim[d]].t - b.t) / 60;
        if (desde >= R.dt_inicio_min && resta >= R.dt_ultima_min && a.e9[i - 1] != null && a.e9[i - 1] <= a.e21[i - 1] && a.e9[i] > a.e21[i] && (!R.dt_vwap || b.c > a.vwap[i]))
          pend.set(a.ticker, { lado: "compra", motivo: `MME 9 cruzou acima da MME 21 (5 min)${R.dt_vwap ? ", preço acima da VWAP" : ""}` });
      }
    }
    // a gap in the data can leave something open: closed at its last price
    for (const p of [...w.pos.values()]) w.vender(p.a, p.ultimo, d, "Zerado no fim do dia (sem mais candles)");
    V.caixa = w.caixa;
    est.dias.push([d, +w.caixa.toFixed(2)]);
  }
  est.caixa = V.caixa;
  for (const m of [...new Set(novas.map(o => o.data.slice(0, 7)))]) {
    const doMes = novas.filter(o => o.data.startsWith(m));
    let antes = []; try { antes = JSON.parse(await readFile(mesArq(m), "utf8")); } catch {}
    await writeFile(mesArq(m), JSON.stringify([...antes, ...doMes]));
  }
  todas.push(...novas);
  est.meses = [...new Set([...meses, ...novas.map(o => o.data.slice(0, 7))])].sort();
  await writeFile(arq, JSON.stringify(est));

  const d0 = est.dias[0]?.[0];
  const curva = est.dias.map(([d, v]) => [d, v, ...bench(addDays(d0, -1), V0, d)]);
  if (curva.length) curva.unshift([addDays(d0, -1), V0, V0, V0]);
  return {
    inicio: d0 || null, ativado_em: ativado, valor_inicial: V0, ultimo_candle: est.dias.at(-1)?.[0] || null,
    patrimonio: +est.caixa.toFixed(2), caixa: +est.caixa.toFixed(2), placar: placar(curva, todas, V0),
    // the page shows the latest 500 trades; the whole history is in the monthly files
    posicoes: [], pendentes: [], operacoes: todas.slice(-500).reverse(), total_operacoes: todas.length, meses: est.meses, curva,
    ativos: { b3: b3.length, eua: ativos.filter(a => a.mercado === "eua").length, cripto: ativos.filter(a => a.mercado === "cripto").length },
  };
}
const nfx = x => x.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

const modos = {};
for (const frame of cfg.modos.filter(m => m === "diario" || m === "semanal")) {
  const dados = await pool(universo, async a => {
    const bars = fechados(await candles(a.sym, FRAMES[frame]), frame, a.mercado);
    const atr = atrSerie(bars), first = bars.findIndex(b => iso(b.t) >= addDays(inicio, -10));
    // analysis of each bar from (just before) the start, on the 300 bars before it
    const sinais = bars.map((_, i) => i < first ? null : analisar(bars.slice(Math.max(0, i - 299), i + 1), frame));
    return { ...a, bars, atr, sinais };
  });
  if (!dados.length) { console.error("sem candles; resultado mantido"); process.exit(1); }
  modos[frame] = simular(frame, dados);
}
if (cfg.modos.includes("daytrade")) modos.daytrade = await daytrade();
for (const [k, m] of Object.entries(modos)) {
  const p = m.placar;
  console.log(`${k}: R$ ${m.patrimonio} (${p.retorno_pct}%) · Ibovespa ${p.ibov_pct}% · CDI ${p.cdi_pct}% · ${p.operacoes} operações, ${p.acerto_pct}% vencedoras`);
}

await mkdir(new URL("bot/", rel), { recursive: true });
await writeFile(new URL("bot/resultado.json", rel), JSON.stringify({
  gerado_em: new Date().toISOString(), config: cfg, regras: R, fixos: FIXOS,
  universo: { b3: universo.filter(a => a.mercado === "b3").length, eua: universo.filter(a => a.mercado === "eua").length, cripto: CRIPTO.filter(() => R.mercados.includes("cripto")).map(c => c[1]) }, modos,
}));
