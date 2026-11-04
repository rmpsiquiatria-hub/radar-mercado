// Carteira → 🤖 Bot (simulação): the user's choice (initial value, modes) is saved through
// /api/preferencias into relatorios/config.json; scripts/bot.mjs (GitHub, every evening and
// right after a new choice) replays the candles and publishes relatorios/bot/resultado.json,
// which this page only reads. Uses the globals of index.html ($, esc, nf, state, save, KEY).
(() => {
  const NOMES = { diario: "Gráfico diário", semanal: "Gráfico semanal" };
  const MERC = { b3: "B3", eua: "EUA", cripto: "Cripto" };
  const box = $("#botBox");
  let cfg, cfgOk = false, res = null, carregado = false, aguardando = null, msg = "", verMais = 50;
  const ui = () => ({ modo: null, merc: "todos", lado: "todos", ...(state.botUi || {}) });
  const setUi = o => { state.botUi = { ...ui(), ...o }; save(); render(); };

  const brl = v => v == null ? "—" : "R$ " + nf(2).format(v);
  const px = (v, m) => (m === "b3" ? "R$ " : "US$ ") + nf(v < 1 ? 4 : 2).format(v);
  const qtd = (v, m) => v.toLocaleString("pt-BR", { maximumFractionDigits: m === "b3" ? 0 : m === "eua" ? 4 : 6 });
  const pc = v => v == null ? "—" : `<span class="${v > 0 ? "pos" : v < 0 ? "neg" : ""}">${v > 0 ? "+" : ""}${nf(2).format(v)}%</span>`;
  const dt = d => d ? d.split("-").reverse().join("/") : "—";

  async function carregar() {
    const [p, r] = await Promise.all([
      fetch("/api/preferencias", { cache: "no-store" }).then(r => r.json()).catch(() => ({})),
      fetch("/relatorios/bot/resultado.json?" + Date.now(), { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    cfgOk = !!p.configurado && !p.erro; cfg = p.bot || (cfgOk ? null : r?.config) || null; res = r; carregado = true;
    if (aguardando && res && res.gerado_em > aguardando) { aguardando = null; msg = "✅ Simulação atualizada."; }
    render();
  }

  function setup() {
    const v = cfg?.valor_inicial ?? "", modos = cfg?.modos || [];
    const escolha = modos.length > 1 ? "todos" : modos[0] || "";
    const opt = (k, t, d, dis) => `<label class="bot-opt${dis ? " dis" : ""}"><input type="radio" name="botModo" value="${k}" ${escolha === k ? "checked" : ""} ${dis ? "disabled" : ""}><span><b>${t}</b><small>${d}</small></span></label>`;
    return `<details class="card bot-setup" ${cfg ? "" : "open"}><summary><b>⚙ ${cfg ? "Configuração do bot" : "Configurar o bot"}</b>${cfg ? `<span class="hint"> · ${brl(cfg.valor_inicial)} · ${modos.map(m => NOMES[m]).join(" e ")} · simulação desde ${dt(cfg.ativado_em)}</span>` : ""}</summary>
      <p class="hint">O bot usa <b>só a análise técnica</b> e dinheiro imaginário. Escolha com quanto ele começa e em que gráfico ele opera. Opera ações da B3, ações dos EUA e criptomoedas.</p>
      <label class="bot-v">Valor inicial (R$)<input id="botValor" type="number" min="100" step="100" inputmode="decimal" value="${v}" placeholder="ex.: 10000"></label>
      <div class="bot-opts">
        ${opt("diario", "Só gráfico diário", "decide no fechamento de cada dia e opera na abertura do dia seguinte")}
        ${opt("semanal", "Só gráfico semanal", "decide no fechamento de sexta e opera na abertura de segunda")}
        ${opt("todos", "Todos em paralelo", "cada modelo começa com o mesmo valor, em carteiras separadas, para comparar")}
        ${opt("dt", "Day trade", "em breve", true)}
      </div>
      ${cfg ? `<label class="hint"><input type="checkbox" id="botReiniciar"> Recomeçar do zero hoje (mudar o valor também recomeça)</label>` : ""}
      <div class="row2" style="margin-top:10px"><button class="btn primary" id="botSalvar" type="button" ${cfgOk ? "" : "disabled"}>Salvar e simular</button>
        <span class="hint" id="botMsg">${esc(msg)}${cfgOk ? "" : "A gravação não está disponível agora."}</span></div>
    </details>`;
  }

  function grafico(curva, ativado) {
    if (!curva?.length) return "";
    const W = 600, H = 190, vals = curva.flatMap(c => c.slice(1).filter(x => x != null)), lo = Math.min(...vals), hi = Math.max(...vals);
    const X = i => (i / Math.max(1, curva.length - 1)) * W, Y = v => H - 8 - (v - lo) / ((hi - lo) || 1) * (H - 16);
    const linha = (k, cor, extra = "") => `<polyline fill="none" stroke="${cor}" stroke-width="2" ${extra} vector-effect="non-scaling-stroke" points="${curva.map((c, i) => c[k] == null ? "" : `${X(i).toFixed(1)},${Y(c[k]).toFixed(1)}`).join(" ")}"/>`;
    const ia = curva.findIndex(c => c[0] >= ativado);
    return `<div class="bot-chart"><div class="bot-leg"><span style="--c:var(--accent)">Bot</span><span style="--c:#d97706">Ibovespa</span><span style="--c:#6366f1">CDI</span>${ia > 0 ? `<span class="hint">┆ início ao vivo (${dt(ativado)})</span>` : ""}</div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Patrimônio do bot comparado com Ibovespa e CDI">
        ${ia > 0 ? `<line x1="${X(ia)}" x2="${X(ia)}" y1="0" y2="${H}" stroke="var(--faint)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>` : ""}
        ${linha(3, "#6366f1", 'stroke-dasharray="5 4"')}${linha(2, "#d97706")}${linha(1, "var(--accent)")}
      </svg><div class="bot-ax hint"><span>${dt(curva[0][0])}</span><span>${brl(lo)} – ${brl(hi)}</span><span>${dt(curva.at(-1)[0])}</span></div></div>`;
  }

  function modoHTML(k, m) {
    const p = m.placar, u = ui();
    const ops = m.operacoes.filter(o => (u.merc === "todos" || o.mercado === u.merc) && (u.lado === "todos" || o.lado === u.lado));
    const tot = (l, v, s = "") => `<div class="card tot"><div class="lbl">${l}</div><div class="v num">${v}</div>${s ? `<div class="hint">${s}</div>` : ""}</div>`;
    return `
      <div class="totals">
        ${tot("Patrimônio", brl(m.patrimonio), `${pc(p.retorno_pct)} desde ${dt(m.inicio)} · caixa ${brl(m.caixa)}`)}
        ${tot("Ibovespa no período", pc(p.ibov_pct), "se tivesse comprado o índice")}
        ${tot("CDI no período", pc(p.cdi_pct), "renda fixa sem risco")}
        ${tot("Maior queda", pc(p.queda_maxima_pct), "do topo ao fundo")}
        ${tot("Operações", `${p.operacoes}`, `${p.acerto_pct == null ? "—" : nf(1).format(p.acerto_pct)}% com lucro · ganho médio ${pc(p.ganho_medio_pct)} · perda média ${pc(p.perda_media_pct)}`)}
        ${tot("Custos pagos", brl(p.custos_brl), "taxas e diferença de preço")}
      </div>
      <p class="hint">De ${dt(m.inicio)} a ${dt(m.ativado_em)} é <b>teste no passado</b> (as mesmas regras aplicadas aos preços antigos); a partir de ${dt(m.ativado_em)} o bot roda <b>ao vivo</b>, todo dia às 19h30${p.ao_vivo_pct != null ? `: ${pc(p.ao_vivo_pct)} desde então` : ""}. Último candle usado: ${dt(m.ultimo_candle)}.</p>
      ${grafico(m.curva, m.ativado_em)}
      <h4 class="sec-t">💼 Posições atuais (${m.posicoes.length})</h4>
      ${m.posicoes.length ? `<div class="card scroll"><table class="grid bot-t"><thead><tr><th>Ativo</th><th>Qtd.</th><th>Compra</th><th>Atual</th><th>Valor</th><th>Resultado</th><th>Stop</th></tr></thead><tbody>
        ${m.posicoes.map(x => `<tr><td><b>${esc(x.ticker)}</b> <small class="bot-m">${MERC[x.mercado]}</small><br><small class="hint">desde ${dt(x.comprado_em)}</small></td><td>${qtd(x.qtd, x.mercado)}</td><td>${px(x.preco_compra, x.mercado)}</td><td>${px(x.preco_atual, x.mercado)}</td><td>${brl(x.valor_brl)}</td><td>${pc(x.resultado_pct)}</td><td>${px(x.stop, x.mercado)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="hint">Tudo em caixa.</p>`}
      <h4 class="sec-t">⏭️ Ordens para a próxima abertura (${m.pendentes.length})</h4>
      ${m.pendentes.length ? `<ul class="bot-pend">${m.pendentes.map(o => `<li><b class="${o.lado === "compra" ? "pos" : "neg"}">${o.lado === "compra" ? "Comprar" : "Vender"} ${esc(o.ticker)}</b> <small class="bot-m">${MERC[o.mercado]}</small> <span class="hint">· ${esc(o.motivo)}</span></li>`).join("")}</ul>` : `<p class="hint">Nenhuma.</p>`}
      <div class="vhead" style="margin-top:16px"><h4 class="sec-t" style="margin:0">📜 Histórico de operações (${ops.length})</h4><button class="btn small" type="button" data-bot-csv="${k}">⬇ Baixar (CSV)</button></div>
      <div class="ftabs dir-f">${[["todos", "Todos"], ...Object.entries(MERC)].map(([v, l]) => `<button role="tab" data-bot-merc="${v}" aria-selected="${u.merc === v}">${l}</button>`).join("")}<span class="bot-sep"></span>
        ${[["todos", "Compras e vendas"], ["compra", "Compras"], ["venda", "Vendas"]].map(([v, l]) => `<button role="tab" data-bot-lado="${v}" aria-selected="${u.lado === v}">${l}</button>`).join("")}</div>
      <div class="card scroll"><table class="grid bot-t"><thead><tr><th>Data</th><th>Ativo</th><th>Operação</th><th>Qtd. · Preço</th><th>Valor</th><th>Resultado</th></tr></thead><tbody>
        ${ops.slice(0, verMais).map(o => `<tr class="${o.teste ? "teste" : ""}"><td>${dt(o.data)}${o.teste ? `<br><small class="hint">teste</small>` : ""}</td><td><b>${esc(o.ticker)}</b> <small class="bot-m">${MERC[o.mercado]}</small></td>
          <td><b class="${o.lado === "compra" ? "pos" : "neg"}">${o.lado === "compra" ? "Compra" : "Venda"}</b><br><small class="hint bot-mot">${esc(o.motivo)}</small></td>
          <td>${qtd(o.qtd, o.mercado)} · ${px(o.preco, o.mercado)}</td><td>${brl(o.valor_brl)}</td><td>${o.lado === "venda" ? `${pc(o.resultado_pct)}<br><small>${brl(o.resultado_brl)}</small>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="hint">Nenhuma operação com esse filtro.</td></tr>`}
      </tbody></table></div>
      ${ops.length > verMais ? `<button class="btn" type="button" id="botMais" style="margin-top:8px">Ver mais ${Math.min(50, ops.length - verMais)}</button>` : ""}`;
  }

  function regrasHTML(r) {
    if (!r) return "";
    const g = r.regras;
    return `<details class="card bot-regras"><summary><b>📏 Regras do bot</b></summary><ul>
      <li><b>Ativos:</b> ${r.universo.b3} ações da B3 (Ibovespa), ${r.universo.eua} dos EUA (sua lista) e as criptomoedas ${r.universo.cripto.join(", ")}.</li>
      <li><b>Compra</b> quando o viés técnico é de alta (pontuação +2 ou mais, a mesma do relatório), a tendência não é de baixa e não há sinal de alta e de baixa ao mesmo tempo. Se há mais candidatos que espaço, entram os de maior pontuação.</li>
      <li><b>Vende</b> quando a tendência vira de baixa, o viés vira de baixa, ou o preço toca o <b>stop</b>: começa ${g.stop_atr} ATR abaixo do preço de compra e sobe junto com o preço (${g.trailing_atr} ATR abaixo do maior fechamento). ATR é o tamanho médio do movimento diário (ou semanal) do ativo.</li>
      <li><b>Tamanho:</b> até ${g.max_posicoes} posições, cada uma com cerca de 1/${g.max_posicoes} do patrimônio. Depois de vender, espera ${g.espera.diario} pregões (diário) ou ${g.espera.semanal} semanas (semanal) para comprar o mesmo ativo de novo.</li>
      <li><b>Sem olhar o futuro:</b> decide com o candle já fechado e executa na abertura do candle seguinte, ${nf(2).format(g.deslize * 100)}% pior que a abertura.</li>
      <li><b>Custos:</b> ${nf(2).format(g.custos.b3 * 100)}% por operação na B3, ${nf(1).format(g.custos.eua * 100)}% nos EUA e em cripto. Ativos em dólar são convertidos pela cotação do dia. <b>Imposto de renda, IOF e dividendos não estão incluídos.</b></li>
    </ul></details>`;
  }

  function render() {
    if (!box) return;
    if (!carregado) { box.innerHTML = `<div class="empty">Carregando…</div>`; return; }
    const u = ui(), modos = res?.modos ? Object.keys(res.modos).filter(k => cfg?.modos?.includes(k) ?? true) : [];
    const k = modos.includes(u.modo) ? u.modo : modos[0];
    const espera = aguardando ? `<div class="note">⏳ Simulando… o bot leva uns 3 minutos para refazer as contas e publicar. Esta página atualiza sozinha.</div>` : "";
    let corpo = "";
    if (!cfg) corpo = `<div class="empty">Escolha o valor inicial e o modo acima para o bot começar.</div>`;
    else if (!k) corpo = aguardando ? "" : `<div class="empty">Ainda não há resultado. Ele aparece alguns minutos depois de salvar.</div>`;
    else {
      const comp = modos.length > 1 ? `<div class="card scroll"><table class="grid"><thead><tr><th>Modelo</th><th>Patrimônio</th><th>Retorno</th><th>Ibovespa</th><th>CDI</th><th>Maior queda</th><th>Operações</th><th>Com lucro</th></tr></thead><tbody>
        ${modos.map(x => { const m = res.modos[x], p = m.placar; return `<tr data-bot-modo="${x}"><td><b>${NOMES[x]}</b></td><td>${brl(m.patrimonio)}</td><td>${pc(p.retorno_pct)}</td><td>${pc(p.ibov_pct)}</td><td>${pc(p.cdi_pct)}</td><td>${pc(p.queda_maxima_pct)}</td><td>${p.operacoes}</td><td>${p.acerto_pct == null ? "—" : nf(1).format(p.acerto_pct) + "%"}</td></tr>`; }).join("")}</tbody></table></div>` : "";
      corpo = `${comp}${modos.length > 1 ? `<div class="ftabs" role="tablist" style="margin-top:12px">${modos.map(x => `<button role="tab" data-bot-modo="${x}" aria-selected="${x === k}">${NOMES[x]}</button>`).join("")}</div>` : `<h4 class="sec-t">${NOMES[k]}</h4>`}
        ${modoHTML(k, res.modos[k])}${regrasHTML(res)}`;
    }
    box.innerHTML = `${setup()}${espera}${corpo}
      <p class="note" style="margin-top:14px">Simulação com dinheiro imaginário, para estudar como regras de análise técnica teriam se saído. Não é recomendação de investimento, e resultado passado não garante resultado futuro.</p>`;
  }

  async function salvar() {
    const v = +$("#botValor").value, esc_ = document.querySelector('input[name="botModo"]:checked')?.value;
    const m = $("#botMsg");
    if (!(v >= 100)) { m.textContent = "Digite um valor inicial de pelo menos R$ 100."; return; }
    if (!esc_) { m.textContent = "Escolha o modo."; return; }
    const modos = esc_ === "todos" ? ["diario", "semanal"] : [esc_];
    m.textContent = "Salvando…";
    try {
      const r = await fetch("/api/preferencias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bot: { valor_inicial: v, modos, reiniciar: !!$("#botReiniciar")?.checked } }) });
      const j = await r.json(); if (!r.ok || j.erro) throw new Error(j.erro || r.status);
      cfg = j.bot; msg = j.mudou ? "" : "Nada mudou.";
      if (j.mudou) { aguardando = new Date().toISOString(); acompanhar(); }
      render();
    } catch (e) { m.textContent = "Não consegui salvar: " + e.message; }
  }
  // after saving, check every 30 s (up to 8 min) until the new result is published
  function acompanhar() {
    let n = 0; const t = setInterval(() => { if (!aguardando || ++n > 16) { clearInterval(t); if (aguardando) { aguardando = null; msg = "A simulação está demorando; volte daqui a pouco."; render(); } return; } carregar(); }, 30000);
  }

  function csv(k) {
    const m = res.modos[k], q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const linhas = [["data", "ativo", "mercado", "operacao", "quantidade", "preco", "valor_brl", "custos_brl", "resultado_brl", "resultado_pct", "teste", "motivo"].join(";"),
      ...m.operacoes.map(o => [o.data, o.ticker, o.mercado, o.lado, o.qtd, o.preco, o.valor_brl, o.custos_brl, o.resultado_brl ?? "", o.resultado_pct ?? "", o.teste ? "sim" : "não", q(o.motivo)].join(";").replace(/(\d)\.(\d)/g, "$1,$2"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `bot-${k}-historico.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  box?.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("#botSalvar")) return salvar();
    if (t.closest("#botMais")) { verMais += 50; return render(); }
    const md = t.closest("[data-bot-modo]"); if (md) { verMais = 50; return setUi({ modo: md.dataset.botModo }); }
    const mc = t.closest("[data-bot-merc]"); if (mc) { verMais = 50; return setUi({ merc: mc.dataset.botMerc }); }
    const ld = t.closest("[data-bot-lado]"); if (ld) { verMais = 50; return setUi({ lado: ld.dataset.botLado }); }
    const c = t.closest("[data-bot-csv]"); if (c) return csv(c.dataset.botCsv);
  });

  // Carteira sub-tabs
  const cartSub = () => { try { return localStorage.getItem(KEY + ".csub") === "bot" ? "bot" : "minha"; } catch { return "minha"; } };
  window.showCartSub = (name = cartSub()) => {
    document.querySelectorAll("[data-csub]").forEach(b => b.setAttribute("aria-selected", b.dataset.csub === name));
    document.querySelectorAll("[data-csub-panel]").forEach(p => p.hidden = p.dataset.csubPanel !== name);
    try { localStorage.setItem(KEY + ".csub", name); } catch {}
    if (name === "bot" && !carregado) { render(); carregar(); }
  };
  document.querySelector(".csubs")?.addEventListener("click", e => { const b = e.target.closest("[data-csub]"); if (b) window.showCartSub(b.dataset.csub); });
  window.showCartSub();
})();
