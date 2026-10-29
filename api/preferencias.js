// POST /api/preferencias {"tempo_grafico": "diario" | "semanal" | "mensal"}
//                     or {"leis": {"destaques": ["fazenda", ...], "lista": ["nomeacoes", ...]}}
// Saves what was chosen in the site's Settings into relatorios/config.json on GitHub, which the
// e-mails read (07:00 market report; Radar de leis). Needs a GITHUB_TOKEN environment variable in
// Vercel (fine-grained token, this repository only, Contents: read and write).
// GET returns what the e-mails currently use and whether syncing is configured.

const REPO = "rmpsiquiatria-hub/radar-mercado";
const FILE = "relatorios/config.json";
const ALLOWED = new Set(["diario", "semanal", "mensal"]);
const AREAS = ["fazenda", "saude", "outros"];
const CATS = ["fazenda", "saude", "nomeacoes", "comissoes", "contratos", "empresas", "servidores", "outros"];
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function gh(path, init = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "radar-mercado", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}
async function readConfig() {
  const f = await gh(`contents/${FILE}?ref=main`);
  return { sha: f.sha, cfg: JSON.parse(Buffer.from(f.content, "base64").toString("utf8")) };
}
// only known values, in a fixed order, so the same choice never makes a new commit
const pick = (list, ok) => Array.isArray(list) && list.every(x => ok.includes(x)) ? ok.filter(x => list.includes(x)) : null;

export async function GET() {
  if (!process.env.GITHUB_TOKEN) return reply({ configurado: false });
  try { const { cfg } = await readConfig(); return reply({ configurado: true, tempo_grafico: cfg.tempo_grafico, leis: cfg.leis || null }); }
  catch (e) { return reply({ configurado: true, erro: e.message }, 502); }
}

export async function POST(request) {
  if (!process.env.GITHUB_TOKEN) return reply({ configurado: false, erro: "sincronização não configurada" }, 501);
  let body; try { body = await request.json(); } catch { return reply({ erro: "corpo inválido" }, 400); }
  const tf = body?.tempo_grafico, leis = body?.leis;
  if (tf === undefined && leis === undefined) return reply({ erro: "nada para salvar" }, 400);
  if (tf !== undefined && !ALLOWED.has(tf)) return reply({ erro: "tempo_grafico deve ser diario, semanal ou mensal" }, 400);
  let novoLeis;
  if (leis !== undefined) {
    novoLeis = { destaques: pick(leis?.destaques, AREAS), lista: pick(leis?.lista, CATS) };
    if (!novoLeis.destaques || !novoLeis.lista) return reply({ erro: `leis.destaques aceita ${AREAS.join(", ")}; leis.lista aceita ${CATS.join(", ")}` }, 400);
  }
  try {
    const { sha, cfg } = await readConfig();
    const antes = JSON.stringify(cfg);
    if (tf !== undefined) cfg.tempo_grafico = tf;
    if (novoLeis) cfg.leis = novoLeis;
    const res = { ok: true, tempo_grafico: cfg.tempo_grafico, leis: cfg.leis || null };
    if (JSON.stringify(cfg) === antes) return reply({ ...res, mudou: false });
    const content = Buffer.from(JSON.stringify(cfg, null, 2) + "\n", "utf8").toString("base64");
    const message = novoLeis ? "E-mail do Radar de leis: filtros escolhidos no site" : `E-mail: gráfico ${tf} (escolhido no site)`;
    await gh(`contents/${FILE}`, { method: "PUT", body: JSON.stringify({ message, content, sha, branch: "main" }) });
    return reply({ ...res, mudou: true });
  } catch (e) { return reply({ erro: e.message }, 502); }
}
