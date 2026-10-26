// POST /api/preferencias {"tempo_grafico": "diario" | "semanal" | "mensal"}
// Saves the timeframe chosen in the site's Settings into relatorios/config.json on GitHub,
// which the 07:00 e-mail reads. Needs a GITHUB_TOKEN environment variable in Vercel
// (fine-grained token, this repository only, Contents: read and write).
// GET returns what the e-mail currently uses and whether syncing is configured.

const REPO = "rmpsiquiatria-hub/radar-mercado";
const FILE = "relatorios/config.json";
const ALLOWED = new Set(["diario", "semanal", "mensal"]);
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

export async function GET() {
  if (!process.env.GITHUB_TOKEN) return reply({ configurado: false });
  try { const { cfg } = await readConfig(); return reply({ configurado: true, tempo_grafico: cfg.tempo_grafico }); }
  catch (e) { return reply({ configurado: true, erro: e.message }, 502); }
}

export async function POST(request) {
  if (!process.env.GITHUB_TOKEN) return reply({ configurado: false, erro: "sincronização não configurada" }, 501);
  let body; try { body = await request.json(); } catch { return reply({ erro: "corpo inválido" }, 400); }
  const tf = body?.tempo_grafico;
  if (!ALLOWED.has(tf)) return reply({ erro: "tempo_grafico deve ser diario, semanal ou mensal" }, 400);
  try {
    const { sha, cfg } = await readConfig();
    if (cfg.tempo_grafico === tf) return reply({ ok: true, tempo_grafico: tf, mudou: false });
    cfg.tempo_grafico = tf;
    const content = Buffer.from(JSON.stringify(cfg, null, 2) + "\n", "utf8").toString("base64");
    await gh(`contents/${FILE}`, { method: "PUT", body: JSON.stringify({ message: `E-mail: gráfico ${tf} (escolhido no site)`, content, sha, branch: "main" }) });
    return reply({ ok: true, tempo_grafico: tf, mudou: true });
  } catch (e) { return reply({ erro: e.message }, 502); }
}
