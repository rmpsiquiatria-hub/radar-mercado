// GET /api/busca?q=itau  → list of matching tickers (stocks, indices, currencies, crypto).

import { yahoo, json, bad } from "./_yahoo.js";

const KINDS = new Set(["EQUITY", "ETF", "INDEX", "CURRENCY", "CRYPTOCURRENCY", "MUTUALFUND"]);

export async function GET(request) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q || q.length > 40) return bad("informe ?q=");
  const data = await yahoo(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}`
    + "&quotesCount=12&newsCount=0&lang=pt-BR&region=BR"
  );
  const items = (data.quotes || [])
    .filter(x => x.symbol && KINDS.has(x.quoteType))
    .map(x => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      type: x.quoteType,
      exchange: x.exchDisp || x.exchange,
    }));
  // Brazilian listings first: that's what the user mostly looks for.
  items.sort((a, b) => (b.symbol.endsWith(".SA") ? 1 : 0) - (a.symbol.endsWith(".SA") ? 1 : 0));
  return json({ items }, 3600);
}
