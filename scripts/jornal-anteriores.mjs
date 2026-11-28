// Mostra os títulos já publicados (últimas 20 edições), para não repetir.
import { readFile, readdir } from "node:fs/promises";

const base = new URL("../relatorios/jornal/", import.meta.url);
console.log(await readFile(new URL("publicadas-antes.txt", base), "utf8").catch(() => ""));
const nomes = await readdir(new URL("edicoes/", base)).catch(() => []);
for (const nome of nomes.filter(f => f.endsWith(".json")).sort().slice(-20)) {
  const ed = JSON.parse(await readFile(new URL(`edicoes/${nome}`, base), "utf8"));
  console.log(`## ${ed.data}`);
  for (const m of ed.materias) console.log(`- [${m.secao}] ${m.titulo}${m.fontes?.[0]?.url?.includes("pubmed") ? ` (${m.fontes[0].url})` : ""}`);
}
