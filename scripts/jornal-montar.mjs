// Junta os arquivos dos grupos (listas de matérias) na edição de hoje. O que já estava publicado é mantido;
// uma matéria com o mesmo id é substituída.
//   node scripts/jornal-montar.mjs /tmp/jornal [AAAA-MM-DD]
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const pasta = process.argv[2];
if (!pasta) { console.error("uso: node scripts/jornal-montar.mjs <pasta> [AAAA-MM-DD]"); process.exit(1); }
const dia = process.argv[3] || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const destino = new URL(`../relatorios/jornal/edicoes/`, import.meta.url);
const arquivo = new URL(`${dia}.json`, destino);
const antes = await readFile(arquivo, "utf8").then(JSON.parse).catch(() => ({ materias: [] }));
const materias = new Map(antes.materias.map(m => [m.id, m]));
let erro = false;
for (const nome of (await readdir(pasta)).filter(f => f.endsWith(".json")).sort()) {
  try {
    const x = JSON.parse(await readFile(join(pasta, nome), "utf8"));
    const lista = Array.isArray(x) ? x : x.materias;
    if (!Array.isArray(lista)) throw new Error("não é uma lista de matérias");
    for (const m of lista) materias.set(m.id, m);
    console.log(nome, lista.length);
  } catch (e) { erro = true; console.error(`${nome}: ${e.message}`); }
}
await mkdir(destino, { recursive: true });
await writeFile(arquivo, JSON.stringify({ data: dia, gerado_em: new Date().toISOString(), materias: [...materias.values()] }, null, 1));
console.log(`edição de ${dia}: ${materias.size} matérias`);
process.exit(erro ? 1 : 0);
