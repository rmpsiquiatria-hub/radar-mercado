// Last closes of the main indices and the dollar, from Yahoo (the same source as the technical
// analysis), into relatorios/mercado.json. The daily e-mail shows them as a table and the Claude
// routine uses them for the market summary, so the numbers no longer depend on a web search.
// Never fails the job: a symbol that does not answer is left out.
import { writeFile } from "node:fs/promises";
import { candles } from "./tecnica-lib.mjs";

// [symbol, name, region, unit, exchange time zone, UTC hour after which that day's bar is final]
const ATIVOS = [
  ["^BVSP", "Ibovespa", "Brasil", "pts", "America/Sao_Paulo", 21.5],
  ["BRL=X", "Dólar (R$)", "Brasil", "R$", "UTC", 21.5],
  ["^GSPC", "S&P 500", "EUA", "pts", "America/New_York", 21.5],
  ["^DJI", "Dow Jones", "EUA", "pts", "America/New_York", 21.5],
  ["^IXIC", "Nasdaq", "EUA", "pts", "America/New_York", 21.5],
  ["000001.SS", "Xangai", "China", "pts", "Asia/Shanghai", 7.5],
  ["^HSI", "Hang Seng (Hong Kong)", "China", "pts", "Asia/Hong_Kong", 8.5],
];

// Each bar is dated in its own exchange's time zone (Yahoo stamps BRL=X at 00:00 UTC and Shanghai
// at 01:30 UTC, which in Brasília time would fall on the previous day). Today's bar counts only
// after that market has closed; Yahoo's extra "live" bar for the same day replaces the earlier one.
const ymd = (t, tz) => new Date(t * 1000).toLocaleDateString("sv-SE", { timeZone: tz });
function fechados(bars, tz, horaUTC) {
  const porDia = new Map();
  for (const b of bars) porDia.set(ymd(b.t, tz), b);
  const agora = new Date(), hoje = agora.toISOString().slice(0, 10);
  const fim = d => d < hoje || (d === hoje && agora.getUTCHours() + agora.getUTCMinutes() / 60 >= horaUTC);
  return [...porDia].filter(([d]) => fim(d)).map(([data, b]) => ({ ...b, data }));
}

const itens = (await Promise.all(ATIVOS.map(async ([simbolo, nome, regiao, unidade, tz, horaUTC]) => {
  try {
    const b = fechados(await candles(simbolo, { range: "1mo", interval: "1d" }), tz, horaUTC);
    if (b.length < 2) return null;
    const [ant, ult] = b.slice(-2);
    return { simbolo, nome, regiao, unidade, data: ult.data, fechamento: +ult.c.toFixed(simbolo === "BRL=X" ? 4 : 2),
      variacao: +((ult.c / ant.c - 1) * 100).toFixed(2) };
  } catch (e) { console.warn(simbolo, e.message); return null; }
}))).filter(Boolean);

const out = { gerado_em: new Date().toISOString(), fonte: "Yahoo Finance (fechamento do último pregão)", itens };
await writeFile("relatorios/mercado.json", JSON.stringify(out, null, 1) + "\n");
console.log(itens.map(i => `${i.nome} ${i.data} ${i.fechamento} (${i.variacao}%)`).join("\n") || "nenhum dado");
