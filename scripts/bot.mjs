// Simulated trading bot (technical analysis only, imaginary money). Reads the user's choice from
// relatorios/config.json → bot: { valor_inicial, modos: ["diario", "semanal", "daytrade"], ativado_em,
// regras } (the rules and their defaults are in lib/bot-regras.js) and writes the portfolio, the trade
// history and the scoreboard of each mode to relatorios/bot/resultado.json.
// Daily and weekly: every closed candle from historico_meses (default 12) months before ativado_em to today is replayed on
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
import { iso, brt, casas, fmt, nfx, criarCarteira, preparar, simularDia, pisoDoMes, motivoLimite } from "../lib/bot-daytrade.js";
import { normalizar } from "../lib/bot-regras.js";

const rel = new URL("../relatorios/", import.meta.url);
const cfg = JSON.parse(await readFile(new URL("config.json", rel), "utf8")).bot;
if (!cfg?.valor_inicial || !cfg.modos?.length) { console.log("Bot não configurado (escolha o valor e o modo no site)."); process.exit(0); }
const R = normalizar(cfg.regras);
// Not configurable: what each trade costs.
const FIXOS = {
  custos: { b3: 0.0003, eua: 0.001, cripto: 0.001 },   // fees per trade (share of the value)
  deslize: 0.0005,          // execution 0.05% worse than the price that triggered it (spread / slippage)
};
const CRIPTO = [["BTC-USD", "Bitcoin"], ["ETH-USD", "Ethereum"], ["SOL-USD", "Solana"], ["XRP-USD", "XRP"], ["BNB-USD", "BNB"]];

const ind = JSON.parse(await readFile(new URL("indicadores.json", rel), "utf8"));
const universo = [
  ...ind.empresas.map(e => ({ ticker: e.ticker, nome: e.nome, mercado: e.bolsa === "B3" ? "b3" : "eua", sym: e.bolsa === "B3" ? e.ticker + ".SA" : e.ticker, peso: e.peso_ibov || 0 })),
  ...CRIPTO.map(([sym, nome]) => ({ ticker: sym.replace("-USD", ""), nome, mercado: "cripto", sym, peso: 0 })),
].filter(a => R.mercados.includes(a.mercado));

const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hoje = brt(Date.now() / 1000).slice(0, 10);
const ativado = cfg.ativado_em || hoje;
const inicio = (() => { const x = new Date(ativado + "T12:00:00Z"); x.setUTCMonth(x.getUTCMonth() - R.historico_meses); return x.toISOString().slice(0, 10); })();

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
// 5 years: covers the longest back test (36 months) with room to spare
const serie = async sym => closedOnly(await candles(sym, { ...FRAMES.diario, range: "5y" }), "diario").map(b => [iso(b.t), b.c]);
const ultimoAte = (s, d) => { let lo = 0, hi = s.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m][0] <= d) { r = s[m][1]; lo = m + 1; } else hi = m - 1; } return r; };
const [ibov, dolar] = await Promise.all([serie("^BVSP"), serie("BRL=X")]);
let cdi = null;
try {
  const br = d => d.split("-").reverse().join("/");
  const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${br(inicio)}&dataFinal=${br(hoje)}`);
  let acc = 1; cdi = (await r.json()).map(x => { acc *= 1 + parseFloat(x.valor) / 100; return [x.data.split("/").reverse().join("-"), acc]; });
} catch (e) { console.error("CDI:", e.message); }
const fx = (m, d) => m === "b3" ? 1 : ultimoAte(dolar, d) || ultimoAte(dolar, addDays(d, 7));

// A wallet: cash in reais, open positions, and the trade log (shared by every mode; lib/bot-daytrade.js).
const carteira = criarCarteira({ custos: FIXOS.custos, fx, ativado });
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
  // the month's loss limit: base = patrimônio at the end of the previous month
  let mes = null, piso = -Infinity, travado = false;

  for (const d of datas) {
    if (d.slice(0, 7) !== mes) { mes = d.slice(0, 7); piso = pisoDoMes(curva.at(-1)?.[1] ?? V0, R); travado = false; }
    const hojeA = dados.filter(a => idx.get(a.ticker).has(d));
    const bar = a => a.bars[idx.get(a.ticker).get(d)];
    // 1. at the open: sales first (they free money), then purchases by score
    for (const a of hojeA) if (pend.get(a.ticker)?.lado === "venda") { if (w.pos.has(a.ticker)) vender(a, bar(a).o * (1 - FIXOS.deslize), d, pend.get(a.ticker).motivo); pend.delete(a.ticker); }
    const compras = travado ? [] : hojeA.filter(a => pend.get(a.ticker)?.lado === "compra").sort((x, y) => pend.get(y.ticker).score - pend.get(x.ticker).score || x.ticker.localeCompare(y.ticker));
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
      } else if (!travado && s.pontuacao >= R.pontuacao_min && s.tendencia !== "baixa" && !conflito(s) && i >= (espera.get(a.ticker) ?? 0)) {
        pend.set(a.ticker, { lado: "compra", score: s.pontuacao, atr: a.atr[i], motivo: `Viés de alta (pontuação +${s.pontuacao}): ${motivoDe(s, "alta")}` });
      } else if (pend.get(a.ticker)?.lado === "compra") pend.delete(a.ticker);
    }
    const v = vd(d);
    // below the limit at the close: everything is sold at the next open, and no buying this month
    if (!travado && w.patrimonio(v) <= piso) {
      travado = true; pend.clear();
      for (const t of w.pos.keys()) pend.set(t, { lado: "venda", motivo: motivoLimite(R) });
    }
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
// Stocks: buys when the 9-period average crosses above the 21-period one (above the VWAP, if chosen)
// or when a candle touches the support and closes above it; sells at the resistance, the target, the
// stop, when the averages cross back down, or before the close. Optional: only on above-average volume.
// Crypto: buys after a rising candle much bigger than the recent ones; stop at that candle's low,
// target a multiple of the risk, and a time limit. Nothing is held overnight (crypto: past 21h).
async function daytrade() {
  const V0 = cfg.valor_inicial, pasta = new URL("bot/daytrade/", rel), arq = new URL("estado.json", pasta);
  const chave = JSON.stringify([V0, ativado, R.mercados, ...Object.entries(R).filter(([k]) => k.startsWith("dt")), R.perda_mensal_pct]);
  let est = null; try { est = JSON.parse(await readFile(arq, "utf8")); } catch {}
  // a shorter back test cuts days already kept: start over; a longer one keeps them (older 5-minute
  // candles no longer exist anyway)
  if (est?.chave !== chave || est.dias[0]?.[0] < inicio) { est = { chave, dias: [], caixa: V0, placar: null }; await rm(pasta, { recursive: true, force: true }); }
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
    return preparar(a, bars, R);
  });
  if (!dados.length) throw new Error("sem candles de 5 minutos");

  // a day is closed once crypto's UTC day has ended (21h in Brasília); the bot runs at 21h30
  const agora = Date.now() / 1000, fechouHoje = (agora - 3 * 3600) % 86400 >= 21 * 3600;
  const ultimoDia = fechouHoje ? hoje : addDays(hoje, -1);
  const feitos = new Set(est.dias.map(x => x[0]));
  const dias = [...new Set(dados.flatMap(a => Object.keys(a.ini)))].filter(d => d >= inicio && d <= ultimoDia && !feitos.has(d) && d > (est.dias.at(-1)?.[0] || "")).sort();
  const novas = [], V = { caixa: est.caixa, ops: novas };

  for (const d of dias) {
    // the month's loss limit, from the patrimônio at the end of the previous month
    const base = est.dias.filter(x => x[0] < d.slice(0, 7) + "-01").at(-1)?.[1] ?? V0;
    const w = simularDia(d, dados, { carteira, V0, V, R, deslize: FIXOS.deslize, piso: pisoDoMes(base, R) });
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
    // the assets and the cash at the end of the last day: the site simulates today live from here
    lista: ativos.map(({ sym, ticker, nome, mercado }) => ({ sym, ticker, nome, mercado })),
    ativos: { b3: b3.length, eua: ativos.filter(a => a.mercado === "eua").length, cripto: ativos.filter(a => a.mercado === "cripto").length },
  };
}

const modos = {};
for (const frame of cfg.modos.filter(m => m === "diario" || m === "semanal")) {
  const dados = await pool(universo, async a => {
    // a test longer than a year needs more daily history than the report's 2 years (300 bars of warm-up)
    const fr = frame === "diario" && R.historico_meses > 12 ? { ...FRAMES.diario, range: "5y" } : FRAMES[frame];
    const bars = fechados(await candles(a.sym, fr), frame, a.mercado);
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
