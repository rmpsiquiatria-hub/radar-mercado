// Prints the full text of acts from the last collection, by id (see relatorios/leis/textos/triagem.txt).
//   node scripts/leis-texto.mjs dou-740643110 rs-1498861 laj-2677-2
import { readFile } from "node:fs/promises";

const ids = process.argv.slice(2);
if (!ids.length) { console.error("uso: node scripts/leis-texto.mjs <id> [<id> ...]"); process.exit(1); }
const esfera = id => id.startsWith("dou-") ? "federal" : id.startsWith("rs-") ? "estadual" : "municipal";
const cache = {};
for (const id of ids) {
  const e = esfera(id);
  cache[e] ??= await readFile(new URL(`../relatorios/leis/textos/${e}.txt`, import.meta.url), "utf8");
  const i = cache[e].indexOf(`=== ${id} ===\n`);
  if (i < 0) { console.log(`=== ${id} === (não encontrado)\n`); continue; }
  const fim = cache[e].indexOf("\n=== ", i + 5);
  console.log(cache[e].slice(i, fim < 0 ? undefined : fim).trim() + "\n");
}
