// Minimal .xlsx reader with no dependencies: unzips with zlib and reads each sheet as a grid of
// strings and numbers. Enough for the government spreadsheets (no formulas evaluated, no dates).
import { inflateRawSync } from "node:zlib";

function unzip(buf) {
  // The central directory sits at the end; find its record, then each file's local header.
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("não é um arquivo zip");
  const n = buf.readUInt16LE(e + 10), files = new Map();
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20), ln = buf.readUInt16LE(p + 28),
      lx = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nome = buf.toString("utf8", p + 46, p + 46 + ln);
    const ini = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), dados = buf.subarray(ini, ini + tam);
    files.set(nome, () => (metodo === 8 ? inflateRawSync(dados) : dados).toString("utf8"));
    p += 46 + ln + lx + lc;
  }
  return files;
}

const ent = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/&amp;/g, "&");
const col = ref => { let c = 0; for (const ch of ref.match(/^[A-Z]+/)[0]) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };

// Returns { "Sheet name": [[cell, ...], ...] } for the sheets asked for (all when none given).
export function lerXlsx(buf, quais) {
  const f = unzip(buf);
  const ss = f.has("xl/sharedStrings.xml") ? [...f.get("xl/sharedStrings.xml")().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => ent([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(""))) : [];
  const rels = Object.fromEntries([...f.get("xl/_rels/workbook.xml.rels")().matchAll(/<Relationship [^>]*>/g)].map(m => [m[0].match(/Id="([^"]+)"/)[1], m[0].match(/Target="([^"]+)"/)[1]]));
  const out = {};
  for (const m of f.get("xl/workbook.xml")().matchAll(/<sheet [^>]*>/g)) {
    const nome = ent(m[0].match(/name="([^"]+)"/)[1]), rid = m[0].match(/r:id="([^"]+)"/)[1];
    if (quais && !quais.includes(nome)) continue;
    const alvo = rels[rid].replace(/^\/?(xl\/)?/, "xl/"), xml = f.get(alvo)?.();
    if (!xml) continue;
    const linhas = [];
    for (const r of xml.matchAll(/<row [^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const lin = [];
      for (const c of r[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/r="([A-Z]+)\d+"/)?.[1], t = c[1].match(/t="([^"]+)"/)?.[1], v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const is = c[2]?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
        if (!ref) continue;
        lin[col(ref)] = t === "s" ? ss[+v] : t === "inlineStr" ? ent(is || "") : t === "str" ? ent(v || "") : v != null ? Number(v) : null;
      }
      linhas[+r[1] - 1] = lin;
    }
    out[nome] = Array.from(linhas, l => l || []);
  }
  return out;
}
