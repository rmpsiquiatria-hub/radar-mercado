// Shared helpers for the Yahoo Finance proxy. Yahoo blocks browser requests
// (no CORS), so the site asks these functions and they ask Yahoo.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export async function yahoo(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  return r.json();
}

export function json(body, maxAge = 15) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`,
    },
  });
}

export function bad(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Accept only ticker-shaped input: letters, digits and . - ^ = (e.g. PETR4.SA, ^BVSP, USDBRL=X, BTC-USD).
export const SYMBOL = /^[A-Za-z0-9.^=\-]{1,20}$/;
