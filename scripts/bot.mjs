// Simulated trading bot (technical analysis only, imaginary money). Reads the user's choice from
// relatorios/config.json → bot: { valor_inicial, modos: ["diario", "semanal"], ativado_em }, replays
// every closed candle from 12 months before ativado_em to today with fixed rules, and writes the
// portfolio, the trade history and the scoreboard of each mode to relatorios/bot/resultado.json.
// The replay is deterministic: the same candles always give the same trades, so the whole history
// is rebuilt on every run (a missed or late run loses nothing). Trades before ativado_em are marked
// "teste" (back test); the ones after it are the bot running live.
// Run: node scripts/bot.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { FRAMES, candles, closedOnly, analisar } from "./tecnica-lib.mjs";

const rel = new URL("../relatorios/", import.meta.url);
const cfg = JSON.parse(await readFile(new URL("config.json", rel), "utf8")).bot;
if (!cfg?.valor_inicial || !cfg.modos?.length) { console.log("Bot não configurado (escolha o valor e o modo no site)."); process.exit(0); }

// The rules, shown on the site as they are here.
const REGRAS = {
  max_posicoes: 6,          // the money is split in up to 6 positions of equal size
  stop_atr: 2,              // initial stop: 2 ATR(14) below the purchase price
  trailing_atr: 3,          // the stop then follows the price, 3 ATR below the highest close
  espera: { diario: 5, semanal: 2 },   // after a sale, bars before buying the same asset again
  custos: { b3: 0.0003, eua: 0.001, cripto: 0.001 },   // fees per trade (share of the value)
  deslize: 0.0005,          // execution 0.05% worse than the open (spread / slippage)
  historico_meses: 12,      // back test before the activation date
};
const CRIPTO = [["BTC-USD", "Bitcoin"], ["ETH-USD", "Ethereum"], ["SOL-USD", "Solana"], ["XRP-USD", "XRP"], ["BNB-USD", "BNB"]];

const ind = JSON.parse(await readFile(new URL("indicadores.json", rel), "utf8"));
const universo = [
  ...ind.empresas.map(e => ({ ticker: e.ticker, nome: e.nome, mercado: e.bolsa === "B3" ? "b3" : "eua", sym: e.bolsa === "B3" ? e.ticker + ".SA" : e.ticker })),
  ...CRIPTO.map(([sym, nome]) => ({ ticker: sym.replace("-USD", ""), nome, mercado: "cripto", sym })),
];

const iso = t => new Date(t * 1000).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const ativado = cfg.ativado_em || hoje;
const inicio = (() => { const x = new Date(ativado + "T12:00:00Z"); x.setUTCMonth(x.getUTCMonth() - REGRAS.historico_meses); return x.toISOString().slice(0, 10); })();

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
// Same reading as the e-mail: crossovers (without MACD) and reversal candles; a company with signals
// both ways is left alone.
const eventos = s => [...s.cruzamentos.filter(c => !/MACD/.test(c.nome)).map(c => c.sinal), ...s.candles.map(c => c.sinal)];
const conflito = s => { const e = eventos(s); return e.includes("alta") && e.includes("baixa"); };
const fmt = x => x.toLocaleString("pt-BR", { maximumSignificantDigits: 5 });
const motivoDe = (s, lado) => s.sinais.filter(x => x.sinal === lado).slice(0, 2).map(x => x.texto).join("; ");

async function pool(items, fn, n = 6) {
  const q = [...items], out = [];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) { const it = q.shift(); try { out.push(await fn(it)); } catch (e) { console.error(it.ticker || it, e.message); } } }));
  return out;
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

function simular(frame, dados) {
  const V0 = cfg.valor_inicial, semanal = frame === "semanal";
  const fx = (m, d) => m === "b3" ? 1 : ultimoAte(dolar, d) || ultimoAte(dolar, addDays(d, 7));
  // value date: a weekly bar is stamped on Monday and closes on Friday
  const vd = d => semanal ? addDays(d, 4) : d;
  const idx = new Map(dados.map(a => [a.ticker, new Map(a.bars.map((b, i) => [iso(b.t), i]))]));
  const datas = [...new Set(dados.flatMap(a => a.bars.map(b => iso(b.t))))].filter(d => d >= inicio).sort();

  let caixa = V0;
  const pos = new Map(), pend = new Map(), espera = new Map(), ops = [], curva = [];
  const patrimonio = d => caixa + [...pos.values()].reduce((s, p) => s + p.qtd * p.ultimo * fx(p.a.mercado, d), 0);
  const casas = m => m === "b3" ? 0 : m === "eua" ? 4 : 6;
  const vender = (a, p, preco, d, motivo) => {
    const bruto = p.qtd * preco * fx(a.mercado, d), custo = bruto * REGRAS.custos[a.mercado];
    caixa += bruto - custo;
    const res = bruto - custo - p.custo_brl;
    ops.push({ data: d, ticker: a.ticker, nome: a.nome, mercado: a.mercado, lado: "venda", qtd: p.qtd, preco: +preco.toPrecision(6), valor_brl: +bruto.toFixed(2), custos_brl: +custo.toFixed(2),
      motivo, resultado_brl: +res.toFixed(2), resultado_pct: +(res / p.custo_brl * 100).toFixed(2), comprado_em: p.data, teste: d < ativado });
    pos.delete(a.ticker); espera.set(a.ticker, idx.get(a.ticker).get(d) + REGRAS.espera[frame]);
  };

  for (const d of datas) {
    const hojeA = dados.filter(a => idx.get(a.ticker).has(d));
    // 1. at the open: sales first (they free money), then stops, then purchases by score
    for (const a of hojeA) {
      const o = pend.get(a.ticker), p = pos.get(a.ticker), b = a.bars[idx.get(a.ticker).get(d)];
      if (o?.lado === "venda" && p) { vender(a, p, b.o * (1 - REGRAS.deslize), d, o.motivo); pend.delete(a.ticker); }
    }
    const compras = hojeA.filter(a => pend.get(a.ticker)?.lado === "compra").sort((x, y) => pend.get(y.ticker).score - pend.get(x.ticker).score || x.ticker.localeCompare(y.ticker));
    for (const a of compras) {
      const o = pend.get(a.ticker); pend.delete(a.ticker);
      if (pos.size >= REGRAS.max_posicoes) continue;
      const b = a.bars[idx.get(a.ticker).get(d)], preco = b.o * (1 + REGRAS.deslize), taxa = REGRAS.custos[a.mercado], cambio = fx(a.mercado, d);
      const alvo = Math.min(patrimonio(d) / REGRAS.max_posicoes, caixa / (1 + taxa));
      const f = 10 ** casas(a.mercado), qtd = Math.floor(alvo / (preco * cambio) * f) / f;
      const bruto = qtd * preco * cambio;
      if (qtd <= 0 || bruto < patrimonio(d) * 0.03) continue;
      const custo = bruto * taxa; caixa -= bruto + custo;
      pos.set(a.ticker, { a, qtd, preco, custo_brl: bruto + custo, data: d, stop: preco - REGRAS.stop_atr * o.atr, ultimo: b.c });
      ops.push({ data: d, ticker: a.ticker, nome: a.nome, mercado: a.mercado, lado: "compra", qtd, preco: +preco.toPrecision(6), valor_brl: +bruto.toFixed(2), custos_brl: +custo.toFixed(2), motivo: o.motivo, teste: d < ativado });
    }
    // 2. during the bar: the stop
    for (const a of hojeA) {
      const p = pos.get(a.ticker); if (!p) continue;
      const b = a.bars[idx.get(a.ticker).get(d)];
      if (b.o <= p.stop) vender(a, p, b.o * (1 - REGRAS.deslize), d, `Stop: abriu abaixo do preço de proteção (${fmt(p.stop)})`);
      else if (b.l <= p.stop) vender(a, p, p.stop * (1 - REGRAS.deslize), d, `Stop: tocou o preço de proteção (${fmt(p.stop)})`);
    }
    // 3. at the close: update prices and stops, then decide what to do at the next open
    for (const a of hojeA) {
      const i = idx.get(a.ticker).get(d), b = a.bars[i], s = a.sinais[i], p = pos.get(a.ticker);
      if (p) { p.ultimo = b.c; p.stop = Math.max(p.stop, b.c - REGRAS.trailing_atr * a.atr[i]); }
      if (!s) continue;
      if (p) {
        if (s.tendencia === "baixa") pend.set(a.ticker, { lado: "venda", motivo: `Tendência virou de baixa: ${motivoDe(s, "baixa")}` });
        else if (s.vies === "baixa" && !conflito(s)) pend.set(a.ticker, { lado: "venda", motivo: `Viés de baixa (pontuação ${s.pontuacao}): ${motivoDe(s, "baixa")}` });
      } else if (s.vies === "alta" && s.tendencia !== "baixa" && !conflito(s) && i >= (espera.get(a.ticker) ?? 0)) {
        pend.set(a.ticker, { lado: "compra", score: s.pontuacao, atr: a.atr[i], motivo: `Viés de alta (pontuação +${s.pontuacao}): ${motivoDe(s, "alta")}` });
      } else if (pend.get(a.ticker)?.lado === "compra") pend.delete(a.ticker);
    }
    const v = vd(d), i0 = ultimoAte(ibov, vd(datas[0])), c0 = cdi && ultimoAte(cdi, vd(datas[0]));
    curva.push([v, +patrimonio(v).toFixed(2), i0 ? +(V0 * ultimoAte(ibov, v) / i0).toFixed(2) : null, c0 ? +(V0 * ultimoAte(cdi, v) / c0).toFixed(2) : null]);
  }

  // scoreboard
  const fim = curva.at(-1)?.[1] ?? V0;
  let topo = -Infinity, dd = 0; for (const [, v] of curva) { topo = Math.max(topo, v); dd = Math.min(dd, v / topo - 1); }
  const vendas = ops.filter(o => o.lado === "venda"), ganhos = vendas.filter(o => o.resultado_brl > 0), perdas = vendas.filter(o => o.resultado_brl <= 0);
  const media = l => l.length ? +(l.reduce((s, o) => s + o.resultado_pct, 0) / l.length).toFixed(2) : null;
  const pctDe = (a, b) => a && b ? +((a / b - 1) * 100).toFixed(2) : null;
  const naAtivacao = curva.filter(c => c[0] < ativado).at(-1);
  const ultimo = curva.at(-1);
  return {
    inicio, ativado_em: ativado, valor_inicial: V0, ultimo_candle: ultimo?.[0] || null,
    patrimonio: +fim.toFixed(2), caixa: +caixa.toFixed(2),
    placar: {
      retorno_pct: pctDe(fim, V0), ibov_pct: pctDe(ultimo?.[2], V0), cdi_pct: pctDe(ultimo?.[3], V0),
      ao_vivo_pct: naAtivacao && ultimo[0] >= ativado ? pctDe(fim, naAtivacao[1]) : null,
      queda_maxima_pct: +(dd * 100).toFixed(2), operacoes: vendas.length,
      acerto_pct: vendas.length ? +(ganhos.length / vendas.length * 100).toFixed(1) : null,
      ganho_medio_pct: media(ganhos), perda_media_pct: media(perdas),
      custos_brl: +ops.reduce((s, o) => s + o.custos_brl, 0).toFixed(2),
    },
    posicoes: [...pos.values()].map(p => {
      const valor = p.qtd * p.ultimo * fx(p.a.mercado, vd(ultimo[0]));
      return { ticker: p.a.ticker, nome: p.a.nome, mercado: p.a.mercado, qtd: p.qtd, preco_compra: +p.preco.toPrecision(6), preco_atual: +p.ultimo.toPrecision(6), comprado_em: p.data,
        valor_brl: +valor.toFixed(2), resultado_pct: +((valor / p.custo_brl - 1) * 100).toFixed(2), stop: +p.stop.toPrecision(5) };
    }).sort((x, y) => y.valor_brl - x.valor_brl),
    // orders for the next open: every sale, and the purchases that fit in the free slots (best score first)
    pendentes: (() => {
      const l = [...pend.entries()].map(([t, o]) => ({ ticker: t, nome: dados.find(a => a.ticker === t).nome, mercado: dados.find(a => a.ticker === t).mercado, lado: o.lado, motivo: o.motivo, score: o.score || 0 }));
      const v = l.filter(o => o.lado === "venda"), livres = REGRAS.max_posicoes - pos.size + v.length;
      return [...v, ...l.filter(o => o.lado === "compra").sort((a, b) => b.score - a.score).slice(0, Math.max(0, livres))].map(({ score, ...o }) => o);
    })(),
    operacoes: ops.reverse(),
    curva,
  };
}

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
  // downloads finish in any order: a fixed order keeps the replay identical from run to run
  dados.sort((x, y) => x.ticker.localeCompare(y.ticker));
  modos[frame] = simular(frame, dados);
  const p = modos[frame].placar;
  console.log(`${frame}: R$ ${modos[frame].patrimonio} (${p.retorno_pct}%) · Ibovespa ${p.ibov_pct}% · CDI ${p.cdi_pct}% · ${p.operacoes} operações, ${p.acerto_pct}% vencedoras`);
}

await mkdir(new URL("bot/", rel), { recursive: true });
await writeFile(new URL("bot/resultado.json", rel), JSON.stringify({
  gerado_em: new Date().toISOString(), config: cfg, regras: REGRAS, universo: { b3: universo.filter(a => a.mercado === "b3").length, eua: universo.filter(a => a.mercado === "eua").length, cripto: CRIPTO.map(c => c[1]) }, modos,
}));
