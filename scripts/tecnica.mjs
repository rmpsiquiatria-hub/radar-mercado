// Builds relatorios/tecnica.json: technical analysis for every company in
// relatorios/indicadores.json, on daily, weekly and monthly candles (Yahoo Finance).
// Moving averages and their crossovers, RSI, MACD, Bollinger bands, trend,
// support/resistance and candlestick reversal patterns. No AI involved.
// Run: node scripts/tecnica.mjs

import { readFile, writeFile } from "node:fs/promises";
import { FRAMES, candles, analyze } from "./tecnica-lib.mjs";

const rel = new URL("../relatorios/", import.meta.url);

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
// Without network (e.g. inside the cloud routine) nothing comes back: keep the previous file.
if (!Object.keys(ativos).length) { console.error("nenhum ativo baixado; tecnica.json mantido"); process.exit(1); }
await writeFile(new URL("tecnica.json", rel), JSON.stringify({ data: today, fonte: "Yahoo Finance (candles)", ativos }, null, 1));
console.log(`Análise técnica: ${Object.keys(ativos).length} ativos.${falhas.length ? " Falhas: " + falhas.join("; ") : ""}`);
