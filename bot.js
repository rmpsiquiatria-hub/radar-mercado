// Carteira → 🤖 Bot (simulação): the user's choice (initial value, modes, buy and sell rules) is saved
// through /api/preferencias into relatorios/config.json; scripts/bot.mjs (GitHub, every evening and
// right after a new choice) replays the candles and publishes relatorios/bot/resultado.json,
// which this page only reads. The rules, their defaults and limits come from lib/bot-regras.js.
// Uses the globals of index.html ($, esc, nf, state, save, KEY).
(() => {
  const NOMES = { diario: "Gráfico diário", semanal: "Gráfico semanal", daytrade: "Day trade (5 min)" };
  const MODOS = ["diario", "semanal", "daytrade"];
  const MERC = { b3: "B3", eua: "EUA", cripto: "Cripto" };
  const box = $("#botBox");
  const PAGINA = 20;                                   // history rows shown at a time
  let cfg, cfgOk = false, res = null, carregado = false, aguardando = null, msg = "", verMais = PAGINA, anteriores = [];
  let SPEC = null, rascunho = null, aberto = null;     // the form being edited survives re-renders
  let vivo = null, vivoBusy = false;                   // today's day trade, simulated live in the browser
  const ui = () => ({ modo: null, merc: "todos", lado: "todos", res: "todos", periodo: "tudo", de: "", ate: "", ...(state.botUi || {}) });
  // the date range of the history filter: [from, to] as YYYY-MM-DD (Brasília), either end may be ""
  const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const menos = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  const faixa = u => u.periodo === "hoje" ? [hojeBR(), hojeBR()] : u.periodo === "7" ? [menos(hojeBR(), 6), ""] : u.periodo === "30" ? [menos(hojeBR(), 29), ""]
    : u.periodo === "datas" ? [u.de, u.ate] : ["", ""];
  const setUi = o => { state.botUi = { ...ui(), ...o }; save(); render(); };

  const brl = v => v == null ? "—" : "R$ " + nf(2).format(v);
  const px = (v, m) => (m === "b3" ? "R$ " : "US$ ") + nf(v < 1 ? 4 : 2).format(v);
  const qtd = (v, m) => v.toLocaleString("pt-BR", { maximumFractionDigits: m === "b3" ? 0 : m === "eua" ? 4 : 6 });
  const pc = v => v == null ? "—" : `<span class="${v > 0 ? "pos" : v < 0 ? "neg" : ""}">${v > 0 ? "+" : ""}${nf(2).format(v)}%</span>`;
  const dt = d => d ? d.split("-").reverse().join("/") : "—";
  // the initial value, typed and shown in reais: "1.234,56" (dots for thousands, comma for cents);
  // a plain "1234.56" or "1234" is read too
  const lerReais = s => { s = String(s ?? "").replace(/[^\d,.]/g, ""); if (!s) return NaN;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, "");
    return +s; };
  const emReais = v => Number.isFinite(v) ? nf(2).format(v) : "";
  const num = v => (+v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

  // Both legs of each trade. A leg with a result closes the position; any other leg opens it, so a
  // position opened by a sale (short) is handled too. Receives the trades in chronological order;
  // "antes" holds older trades, for a closing leg whose opening fell outside the published list.
  function parear(ops, antes = []) {
    const abertas = new Map(), pares = new Map();
    for (const o of ops) {
      const k = o.mercado + o.ticker;
      if (o.resultado_pct == null) { const p = { vendida: o.lado === "venda", abre: o, fecha: null }; abertas.set(k, p); pares.set(o, p); continue; }
      const quando = x => `${x.data} ${x.hora || ""}`;
      const p = abertas.get(k) || { vendida: o.lado === "compra", abre: antes.findLast(x => x.mercado === o.mercado && x.ticker === o.ticker && x.lado !== o.lado && x.qtd === o.qtd && x.resultado_pct == null && quando(x) <= quando(o)) || null };
      abertas.delete(k); p.fecha = o; pares.set(o, p);
    }
    return pares;
  }
  const saida = m => /^Resist/.test(m) ? "Resistência" : /^Alvo/.test(m) ? "Alvo atingido" : /^Limite de perda/.test(m) ? "Limite do mês" : /^Stop/.test(m) ? "Stop" : /^Zerado/.test(m) ? "Zerada" : /^Tempo/.test(m) ? "Tempo máximo" : "Sinal de saída";
  const pernas = p => { const c = p.vendida ? p.fecha : p.abre, v = p.vendida ? p.abre : p.fecha; return { compra: c?.preco ?? null, venda: v?.preco ?? null, cOp: c, vOp: v, motivo: p.fecha ? saida(p.fecha.motivo) : null }; };

  async function carregar() {
    const [p, r, s] = await Promise.all([
      fetch("/api/preferencias", { cache: "no-store" }).then(r => r.json()).catch(() => ({})),
      fetch("/relatorios/bot/resultado.json?" + Date.now(), { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null),
      SPEC ? SPEC : import("/lib/bot-regras.js").catch(() => null),
    ]);
    // the page only gets the latest trades: the oldest sales may have been bought just before them
    const dtr = r?.modos?.daytrade, velha = dtr?.total_operacoes > dtr?.operacoes.length ? dtr.operacoes.at(-1)?.data.slice(0, 7) : null;
    anteriores = velha ? await fetch(`/relatorios/bot/daytrade/ops-${velha}.json`).then(x => x.ok ? x.json() : []).catch(() => []) : [];
    SPEC = s; cfgOk = !!p.configurado && !p.erro; cfg = p.bot || (cfgOk ? null : r?.config) || null; res = r; carregado = true;
    if (aguardando && res && res.gerado_em > aguardando) { aguardando = null; msg = "✅ Simulação atualizada."; }
    render();
    if (res?.modos?.daytrade) { await aoVivo(); render(); }
  }

  // Today's day trade, live: the night run (scripts/bot.mjs) only simulates closed days, so while the
  // market is open the page fetches today's 5-minute candles and runs the same code
  // (lib/bot-daytrade.js) from the cash the last closed day ended with. Refreshed every minute.
  async function aoVivo() {
    const m = res?.modos?.daytrade;
    if (!m?.lista?.length || !res.regras || vivoBusy) return;
    const agora = Date.now() / 1000, L = await import("/lib/bot-daytrade.js"), d = L.brt(agora).slice(0, 10);
    if (m.ultimo_candle && m.ultimo_candle >= d) { vivo = null; return; }   // tonight's run already has today
    vivoBusy = true;
    try {
      const syms = m.lista.map(a => a.sym), lotes = [];
      for (let i = 0; i < syms.length; i += 20) lotes.push(syms.slice(i, i + 20));
      const pedir = (s, q) => fetch(`/api/cotacoes?s=${encodeURIComponent(s.join(","))}&${q}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
      const [usd, ...partes] = await Promise.all([pedir(["USDBRL=X"], "range=1d"), ...lotes.map(l => pedir(l, "range=5d&iv=5m&ohlc=1"))]);
      const Q = Object.assign({}, ...partes.map(p => p?.quotes || {})), dolar = usd?.quotes?.["USDBRL=X"]?.price;
      if (!dolar || !partes.some(p => p)) throw new Error("sem preços");
      const R = res.regras, dados = [];
      for (const a of m.lista) {
        const q = Q[a.sym]; if (!q?.bars?.length) continue;
        // only closed candles: the one still forming waits for the next refresh
        const bars = q.bars.filter(b => b[0] + 300 <= agora).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
        const x = L.preparar(a, bars, R);
        if (x.ini[d] == null) continue;
        // the day's last bar has not happened yet: it comes when the session (crypto: the UTC day) ends
        const fimT = a.mercado === "cripto" ? Date.parse(d + "T00:00:00Z") / 1000 + 86400 - 300
          : q.session?.end && L.brt(q.session.end).slice(0, 10) === d ? q.session.end - 300
          : Date.parse(d + (a.mercado === "b3" ? "T19:55:00Z" : "T20:55:00Z")) / 1000;
        x.ultimoT[d] = Math.max(x.ultimoT[d], fimT);
        dados.push(x);
      }
      const carteira = L.criarCarteira({ custos: res.fixos.custos, fx: mk => mk === "b3" ? 1 : dolar, ativado: m.ativado_em });
      // the month's loss limit, from the patrimônio at the end of the previous month (as the night run)
      const base = (m.curva || []).filter(c => c[0] < d.slice(0, 7) + "-01").at(-1)?.[1] ?? m.valor_inicial;
      const w = L.simularDia(d, dados, { carteira, V0: m.valor_inicial, V: { caixa: m.caixa, ops: [] }, R, deslize: res.fixos.deslize, aoVivo: true, piso: L.pisoDoMes(base, R) });
      const posicoes = [...w.pos.values()].map(p => {
        const valor = p.qtd * p.ultimo * (p.a.mercado === "b3" ? 1 : dolar), r = valor * (1 - res.fixos.custos[p.a.mercado]) - p.custo_brl;
        return { ticker: p.a.ticker, mercado: p.a.mercado, atual: p.ultimo, resultado_brl: r, resultado_pct: r / p.custo_brl * 100 };
      });
      vivo = { dia: d, em: agora, ops: w.ops, posicoes, pendentes: w.pendentes, patrimonio: w.patrimonio(d), inicio: m.caixa, travado: !!w.travado, erro: null };
    } catch (e) { vivo = { ...(vivo || {}), dia: d, em: agora, erro: String(e.message || e) }; }
    finally { vivoBusy = false; }
  }

  // the form: what is saved, or what is being typed
  const form = () => rascunho || {
    valor: cfg?.valor_inicial != null ? emReais(cfg.valor_inicial) : "",
    escolha: (cfg?.modos || []).length > 1 ? "todos" : cfg?.modos?.[0] || "",
    regras: SPEC ? SPEC.normalizar(cfg?.regras) : {},
  };
  // only the rules of the chosen mode(s) and markets: [group, title, filter of its rules]
  function gruposVisiveis(f) {
    const modos = f.escolha === "todos" ? MODOS : f.escolha ? [f.escolha] : [], merc = f.regras.mercados || [];
    const d = modos.includes("diario"), s = modos.includes("semanal"), dt = modos.includes("daytrade");
    return Object.entries(SPEC.GRUPOS).flatMap(([g, t]) => {
      if (g === "risco") return modos.length ? [[g, t]] : [];
      if (g === "geral") return d || s ? [[g, d && s ? t : d ? "Gráfico diário" : "Gráfico semanal", x => x.k !== (d ? "espera_semanal" : "espera_diario") || (d && s)]] : [];
      if (g === "dt") return dt && (merc.includes("b3") || merc.includes("eua")) ? [[g, t]] : [];
      if (g === "dtc") return dt && merc.includes("cripto") ? [[g, t]] : [];
      if (g === "dtx") return dt ? [[g, t]] : [];
      return [[g, t]];
    });
  }
  function regrasForm(f) {
    if (!SPEC) return "";
    const campo = x => {
      const v = f.regras[x.k];
      if (x.tipo === "bool") return `<label class="bot-r bool"><input type="checkbox" data-regra="${x.k}" ${v ? "checked" : ""}> ${x.label}</label>`;
      if (x.tipo === "lista") return `<div class="bot-r"><span>${x.label}</span><span class="bot-chk">${x.opcoes.map(([o, l]) => `<label><input type="checkbox" data-regra="${x.k}" value="${o}" ${v.includes(o) ? "checked" : ""}> ${l}</label>`).join("")}</span>${x.ajuda ? `<small>${x.ajuda}</small>` : ""}</div>`;
      return `<label class="bot-r"><span>${x.label}</span><input type="number" data-regra="${x.k}" min="${x.min}" max="${x.max}" step="${x.passo}" value="${v}"><small>${x.ajuda ? x.ajuda + " " : ""}De ${num(x.min)} a ${num(x.max)} · padrão ${num(x.padrao)}.</small></label>`;
    };
    return `<details class="bot-rd" ${aberto?.regras ? "open" : ""} data-bot-fold="regras"><summary><b>📏 Regras de compra e venda</b> <span class="hint">· opcional; já vem com valores padrão</span></summary>
      ${gruposVisiveis(f).map(([g, t, so]) => `<fieldset class="bot-g"><legend>${t}</legend>${SPEC.REGRAS.filter(x => x.g === g && (!so || so(x))).map(campo).join("")}</fieldset>`).join("")}
      ${f.escolha ? "" : `<p class="hint">Escolha o modo acima para ver as regras dele.</p>`}
      <p class="hint">Mudar as regras refaz o histórico do diário e do semanal com as regras novas (mantendo a data de início). O day trade recomeça com os dias que ainda existem nos dados de 5 minutos (cerca de 60).</p>
      <button class="btn small" type="button" id="botPadrao">Voltar tudo ao padrão</button>
    </details>`;
  }
  // which markets: its own block above the modes, since it applies to all of them
  function mercadosForm(f) {
    if (!SPEC) return "";
    const x = SPEC.REGRAS.find(r => r.k === "mercados"), v = f.regras.mercados || [];
    const det = { b3: "as ações do Ibovespa", eua: "as ações dos EUA da sua lista", cripto: "BTC, ETH, SOL, XRP e BNB" };
    return `<fieldset class="bot-g bot-merc"><legend>${x.label}</legend><span class="bot-chk">${x.opcoes.map(([o, l]) => `<label><input type="checkbox" data-regra="mercados" value="${o}" ${v.includes(o) ? "checked" : ""}> <b>${l}</b> <small>${det[o]}</small></label>`).join("")}</span><small class="hint">${x.ajuda}</small></fieldset>`;
  }
  // how long the back test is: also its own block, with the date it starts at
  function periodoForm(f) {
    const x = SPEC?.REGRAS.find(r => r.k === "historico_meses"); if (!x) return "";
    const v = f.regras.historico_meses, base = cfg?.ativado_em || hojeBR(), ini = new Date(base + "T12:00:00Z");
    ini.setUTCMonth(ini.getUTCMonth() - v);
    return `<fieldset class="bot-g bot-merc"><legend>${x.label}</legend><label class="bot-r"><span>Meses de teste antes de ${dt(base)}</span><input type="number" data-regra="historico_meses" min="${x.min}" max="${x.max}" step="${x.passo}" value="${v}">
      <small>Com ${v} ${v === 1 ? "mês" : "meses"}, o teste do diário e do semanal começa em <b>${dt(ini.toISOString().slice(0, 10))}</b>. De ${x.min} a ${x.max} meses · padrão ${x.padrao}. ${x.ajuda}</small></label></fieldset>`;
  }
  function setup() {
    const f = form(), modos = cfg?.modos || [];
    const opt = (k, t, d) => `<label class="bot-opt"><input type="radio" name="botModo" value="${k}" ${f.escolha === k ? "checked" : ""}><span><b>${t}</b><small>${d}</small></span></label>`;
    return `<details class="card bot-setup" ${(aberto?.setup ?? !cfg) ? "open" : ""} data-bot-fold="setup"><summary><b>⚙ ${cfg ? "Configuração do bot" : "Configurar o bot"}</b>${cfg ? `<span class="hint"> · ${brl(cfg.valor_inicial)} · ${modos.map(m => NOMES[m]).join(", ")}${SPEC ? " · " + SPEC.normalizar(cfg.regras).mercados.map(m => ({ b3: "B3", eua: "EUA", cripto: "Cripto" })[m]).join(", ") : ""} · simulação desde ${dt(cfg.ativado_em)}</span>` : ""}</summary>
      <p class="hint">O bot usa <b>só a análise técnica</b> e dinheiro imaginário. Escolha com quanto ele começa, em quais mercados, em que gráfico opera e, se quiser, as regras.</p>
      <label class="bot-v">Valor inicial (R$)<input id="botValor" type="text" inputmode="decimal" autocomplete="off" value="${esc(f.valor)}" placeholder="ex.: 10.000,00"></label>
      ${mercadosForm(f)}
      ${periodoForm(f)}
      <div class="bot-opts">
        ${opt("diario", "Só gráfico diário", "decide no fechamento de cada dia e opera na abertura do dia seguinte")}
        ${opt("semanal", "Só gráfico semanal", "decide no fechamento de sexta e opera na abertura de segunda")}
        ${opt("daytrade", "Só day trade", "candles de 5 minutos; compra e vende no mesmo dia, nunca dorme posicionado")}
        ${opt("todos", "Todos em paralelo", "os três modelos, cada um com o mesmo valor inicial, em carteiras separadas, para comparar")}
      </div>
      ${regrasForm(f)}
      ${cfg ? `<label class="hint" style="display:block;margin-top:8px"><input type="checkbox" id="botReiniciar"> Recomeçar do zero hoje (mudar o valor também recomeça)</label>` : ""}
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

  function vivoHTML() {
    if (!vivo) return "";
    const hora = t => new Date(t * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (!vivo.ops) return `<div class="card bot-vivo-box">🔴 <b>Hoje ao vivo</b> · não consegui buscar os preços agora (${esc(vivo.erro || "")}). Tento de novo em 1 minuto.</div>`;
    const dia = vivo.patrimonio - vivo.inicio, enc = vivo.ops.filter(o => o.lado === "venda").length;
    return `<div class="card bot-vivo-box"><b><span class="bot-vivo">●</span> Hoje ao vivo (${dt(vivo.dia)})</b><span class="hint"> · atualizado às ${hora(vivo.em)}, a cada minuto${vivo.erro ? " · ⚠ a última atualização falhou" : ""}</span>
      <div class="bot-vivo-n">${vivo.ops.length} operações hoje · ${enc} encerradas · ${vivo.posicoes.length} abertas${vivo.pendentes?.length ? ` · ${vivo.pendentes.length} ordem(ns) para o próximo candle` : ""} · resultado do dia <b class="${dia > 0 ? "pos" : dia < 0 ? "neg" : ""}">${dia >= 0 ? "+" : "−"}${brl(Math.abs(dia))}</b> · patrimônio agora ${brl(vivo.patrimonio)}</div>
      ${vivo.travado ? `<div class="note">🛑 <b>Limite de perda do mês atingido</b> (−${num(res.regras.perda_mensal_pct)}%): o bot vendeu tudo e só volta a operar no dia 1º do mês que vem.</div>` : ""}
      <small class="hint">As operações de hoje aparecem no histórico abaixo, marcadas "ao vivo". Os preços da B3 podem chegar com até 15 minutos de atraso. Às 21h30 o dia é fechado e guardado; os números podem mudar um pouco (dólar de fechamento e candles revisados).</small></div>`;
  }

  function modoHTML(k, m) {
    const p = m.placar, u = ui(), dtr = k === "daytrade";
    // day trade: today's live trades on top of the closed days, and the price now of what is still open
    const hoje = dtr && vivo?.ops ? [...vivo.ops].reverse().map(o => ({ ...o, ao_vivo: true })) : [];
    m = { ...m, operacoes: [...hoje, ...m.operacoes] };
    const atual = new Map((dtr && vivo?.posicoes || []).map(x => [x.mercado + x.ticker, x]));
    const [de, ate] = faixa(u);
    const pares = parear([...m.operacoes].reverse(), anteriores);
    // the outcome of the trade each row belongs to: both rows of a closed trade share it
    const desfecho = o => { const f = pares.get(o)?.fecha; return !f ? "andamento" : f.resultado_brl > 0 ? "lucro" : "prejuizo"; };
    modoAtual = k; paresAtuais = pares;
    const ops = opsVisiveis = m.operacoes.filter(o => (u.merc === "todos" || o.mercado === u.merc) && (u.lado === "todos" || o.lado === u.lado) && (u.res === "todos" || desfecho(o) === u.res) && (!de || o.data >= de) && (!ate || o.data <= ate));
    // every number below covers the same period: from the start of the test to the last closed day
    const fim = m.ultimo_candle || m.curva?.at(-1)?.[0], per = `de ${dt(m.inicio)} a ${dt(fim)}`;
    const dias = m.inicio && fim ? Math.round((Date.parse(fim) - Date.parse(m.inicio)) / 864e5) + 1 : null;
    let topo = null, queda = null;
    for (const c of m.curva || []) { if (c[1] == null) continue; if (!topo || c[1] > topo[1]) topo = c; const q = c[1] / topo[1] - 1; if (!queda || q < queda.q) queda = { q, de: topo[0], ate: c[0] }; }
    const fechadas = [...new Set(ops.map(o => pares.get(o)).filter(x => x?.fecha?.resultado_brl != null))];
    const soma = fechadas.reduce((s, x) => s + x.fecha.resultado_brl, 0), nLucro = fechadas.filter(x => x.fecha.resultado_brl > 0).length;
    const custoT = fechadas.reduce((s, x) => s + (x.fecha.custos_brl || 0) + (x.abre?.custos_brl || 0), 0);
    const tot = (l, v, s = "") => `<div class="card tot"><div class="lbl">${l}</div><div class="v num">${v}</div>${s ? `<div class="hint">${s}</div>` : ""}</div>`;
    const quando = dtr
      ? `O day trade usa candles de 5 minutos, que o Yahoo guarda por cerca de 60 dias: por isso o teste no passado dele começou em ${dt(m.inicio)}, mesmo que você escolha um teste mais longo. A partir de ${dt(m.ativado_em)} cada dia é simulado ao vivo às 21h30 e fica guardado.`
      : `De ${dt(m.inicio)} a ${dt(m.ativado_em)} é <b>teste no passado</b> (as mesmas regras aplicadas aos preços antigos); a partir de ${dt(m.ativado_em)} o bot roda <b>ao vivo</b>, todo dia às 21h30.`;
    return `
      <p class="bot-per">📅 <b>Período dos números abaixo: ${per}</b>${dias ? ` (${dias} dias)` : ""}. Teste no passado até ${dt(menos(m.ativado_em, 1))}, ao vivo desde ${dt(m.ativado_em)}.${dtr && vivo?.ops ? " O dia de hoje, ao vivo, ainda não entra nestes números (ele aparece no quadro vermelho e no histórico)." : ""}</p>
      <div class="totals">
        ${tot("Patrimônio", brl(m.patrimonio), `${pc(p.retorno_pct)} ${per}${dtr ? "" : ` · caixa ${brl(m.caixa)}`}`)}
        ${tot("Ibovespa no mesmo período", pc(p.ibov_pct), `${per} · se tivesse comprado o índice`)}
        ${tot("CDI no mesmo período", pc(p.cdi_pct), `${per} · renda fixa sem risco`)}
        ${tot("Maior queda", pc(p.queda_maxima_pct), queda && queda.q < 0 ? `do topo em ${dt(queda.de)} ao fundo em ${dt(queda.ate)}` : "do topo ao fundo")}
        ${tot("Operações encerradas", `${p.operacoes}`, `${per} · cada uma é uma compra e a venda dela · ${p.acerto_pct == null ? "—" : nf(1).format(p.acerto_pct)}% com lucro · ganho médio ${pc(p.ganho_medio_pct)} · perda média ${pc(p.perda_media_pct)}`)}
        ${tot("Custos pagos", brl(p.custos_brl), `${per} · taxas e diferença de preço`)}
      </div>
      ${limiteHTML(m, k)}
      <p class="hint">${quando}${p.ao_vivo_pct != null ? ` Ao vivo: ${pc(p.ao_vivo_pct)}.` : ""} Último dia usado: ${dt(m.ultimo_candle)}.</p>
      ${grafico(m.curva, m.ativado_em)}
      ${dtr ? `<p class="hint">💤 No day trade tudo é vendido no mesmo dia (cripto: até as 21h), então não há posições abertas de um dia para o outro.</p>` : `
      <h4 class="sec-t">💼 Posições atuais (${m.posicoes.length})</h4>
      ${m.posicoes.length ? `<div class="card scroll"><table class="grid bot-t"><thead><tr><th>Ativo</th><th>Qtd.</th><th>Compra</th><th>Atual</th><th>Valor</th><th>Resultado</th><th>Stop</th></tr></thead><tbody>
        ${m.posicoes.map(x => `<tr><td><b>${esc(x.ticker)}</b> <small class="bot-m">${MERC[x.mercado]}</small><br><small class="hint">desde ${dt(x.comprado_em)}</small></td><td>${qtd(x.qtd, x.mercado)}</td><td>${px(x.preco_compra, x.mercado)}</td><td>${px(x.preco_atual, x.mercado)}</td><td>${brl(x.valor_brl)}</td><td>${pc(x.resultado_pct)}</td><td>${px(x.stop, x.mercado)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="hint">Tudo em caixa.</p>`}
      <h4 class="sec-t">⏭️ Ordens para a próxima abertura (${m.pendentes.length})</h4>
      ${m.pendentes.length ? `<ul class="bot-pend">${m.pendentes.map(o => `<li><b class="${o.lado === "compra" ? "pos" : "neg"}">${o.lado === "compra" ? "Comprar" : "Vender"} ${esc(o.ticker)}</b> <small class="bot-m">${MERC[o.mercado]}</small> <span class="hint">· ${esc(o.motivo)}</span></li>`).join("")}</ul>` : `<p class="hint">Nenhuma.</p>`}`}
      ${dtr ? vivoHTML() : ""}
      <div class="vhead" style="margin-top:16px"><h4 class="sec-t" style="margin:0">📜 Histórico de operações (${m.total_operacoes > m.operacoes.length - hoje.length ? `${m.total_operacoes + hoje.length}; aqui as ${m.operacoes.length} mais recentes` : ops.length})</h4><button class="btn small" type="button" data-bot-csv="${k}">⬇ Baixar tudo (CSV)</button></div>
      <div class="ftabs dir-f">${[["todos", "Todos"], ...Object.entries(MERC)].map(([v, l]) => `<button role="tab" data-bot-merc="${v}" aria-selected="${u.merc === v}">${l}</button>`).join("")}<span class="bot-sep"></span>
        ${[["todos", "Compras e vendas"], ["compra", "Compras"], ["venda", "Vendas"]].map(([v, l]) => `<button role="tab" data-bot-lado="${v}" aria-selected="${u.lado === v}">${l}</button>`).join("")}<span class="bot-sep"></span>
        ${[["todos", "Qualquer resultado"], ["lucro", "Com lucro"], ["prejuizo", "Com prejuízo"], ["andamento", "Em andamento"]].map(([v, l]) => `<button role="tab" data-bot-res="${v}" aria-selected="${u.res === v}">${l}</button>`).join("")}</div>
      <div class="ftabs dir-f bot-datas">${[["hoje", "Hoje"], ["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["tudo", "Todas as datas"]].map(([v, l]) => `<button role="tab" data-bot-periodo="${v}" aria-selected="${u.periodo === v}">${l}</button>`).join("")}<span class="bot-sep"></span>
        <label class="hint">de <input type="date" data-bot-data="de" value="${esc(de)}"></label><label class="hint">até <input type="date" data-bot-data="ate" value="${esc(ate)}"></label>
        ${u.periodo !== "tudo" || u.res !== "todos" || u.merc !== "todos" || u.lado !== "todos" ? `<span class="hint">${ops.length} ${ops.length === 1 ? "linha" : "linhas"} com esses filtros</span>` : ""}</div>
      <div class="card scroll"><table class="grid bot-t"><thead><tr><th>Data</th><th>Ativo</th><th>Operação</th><th>Status</th><th>Qtd.</th><th>Compra</th><th>Venda</th><th>Valor</th><th>Resultado</th></tr></thead><tbody>
        ${ops.slice(0, verMais).map((o, idx) => { const p = pares.get(o), l = pernas(p), // when each leg happened: the time, plus the date if it was another day
          quando = x => !x ? "" : x.data === o.data ? x.hora || "" : dt(x.data) + (x.hora ? " " + x.hora : ""),
          preco = (v, lado, x) => v == null ? "—" : (o.lado === lado ? `<b>${px(v, o.mercado)}</b>` : px(v, o.mercado)) + (quando(x) ? `<br><small class="hint">${quando(x)}</small>` : ""),
          // the result belongs to the trade: shown on both rows once it is closed
          f = p.fecha, ag = !p.fecha && o.ao_vivo ? atual.get(o.mercado + o.ticker) : null;
          return `<tr class="${o.teste ? "teste" : ""}"><td>${dt(o.data)}${o.hora ? ` ${o.hora}` : ""}${o.teste ? `<br><small class="hint">teste</small>` : o.ao_vivo ? `<br><small class="bot-vivo">● ao vivo</small>` : ""}</td><td><b>${esc(o.ticker)}</b> <small class="bot-m">${MERC[o.mercado]}</small></td>
          <td><b class="${o.lado === "compra" ? "pos" : "neg"}">${o.lado === "compra" ? "Compra" : "Venda"}</b><br><small class="hint bot-mot">${esc(o.motivo)}</small></td>
          <td>${p.fecha ? `Encerrada<br><small class="hint">${l.motivo}</small>` : `<span class="tag on">Aberta</span>`}${p.vendida ? ` <small class="bot-m">vendida</small>` : ""}<br><button class="link bot-gbtn" type="button" data-bot-graf="${idx}">📈 Ver gráfico</button></td>
          <td>${qtd(o.qtd, o.mercado)}</td><td>${preco(l.compra, "compra", l.cOp)}</td><td>${ag ? `<small class="hint">agora</small> ${px(ag.atual, o.mercado)}` : preco(l.venda, "venda", l.vOp)}</td><td>${brl(o.valor_brl)}</td><td>${f?.resultado_pct != null ? `${pc(f.resultado_pct)}<br><small>${brl(f.resultado_brl)}</small>` : ag ? `${pc(ag.resultado_pct)}<br><small class="hint">se vendesse agora</small>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="9" class="hint">Nenhuma operação com esse filtro.</td></tr>`}
      </tbody>${fechadas.length ? `<tfoot><tr class="bot-tot"><td colspan="8"><b>Total</b> das ${fechadas.length} ${fechadas.length === 1 ? "operação encerrada" : "operações encerradas"} desta lista (${nLucro} com lucro, ${fechadas.length - nLucro} com prejuízo; cada operação conta uma vez, mesmo aparecendo na compra e na venda) · custos ${brl(custoT)}${ops.length > verMais ? " · inclui as linhas ainda não mostradas" : ""}</td>
        <td>${pc(soma / m.valor_inicial * 100)}<br><small>${soma < 0 ? "−" : ""}${brl(Math.abs(soma))}</small><br><small class="hint">% do valor inicial</small></td></tr></tfoot>` : ""}</table></div>
      ${ops.length > verMais ? `<button class="btn" type="button" id="botMais" style="margin-top:8px">Ver mais ${Math.min(PAGINA, ops.length - verMais)}</button>` : ""}`;
  }

  // One trade on its chart, from a little before the purchase to a little after the sale, and the
  // story of why it made or lost money, told from the candles. Opened by "📈 Ver gráfico" in the history.
  let dlg = null, opsVisiveis = [], paresAtuais = null, modoAtual = null;
  const simbolo = o => o.mercado === "b3" ? o.ticker + ".SA" : o.mercado === "cripto" ? o.ticker + "-USD" : o.ticker;
  const pcT = v => `${v > 0 ? "+" : ""}${nf(2).format(v)}%`;
  async function graficoOperacao(i) {
    const o = opsVisiveis[i], p = paresAtuais?.get(o); if (!o || !p) return;
    const l = pernas(p), ent = l.cOp || o, sai = l.vOp, k = modoAtual, intra = k === "daytrade", A = window.Analise;
    if (!dlg) {
      dlg = document.body.appendChild(Object.assign(document.createElement("dialog"), { className: "vdlg bot-gdlg" }));
      dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest("[data-gclose]")) dlg.close(); });
    }
    const topo = `<div class="vdlg-h"><h2>${esc(o.ticker)} <small class="bot-m">${MERC[o.mercado]}</small> <small class="hint">${NOMES[k]}</small></h2><button class="btn small" type="button" data-gclose>✕ Fechar</button></div>`;
    dlg.innerHTML = `<div class="card">${topo}<div class="empty">Carregando os candles…</div></div>`;
    if (!dlg.open) dlg.showModal();
    // the candles around the trade: 5-minute ones exist for ~60 days only
    const dias = (Date.now() - Date.parse(ent.data + "T12:00:00Z")) / 864e5;
    const [range, iv] = intra ? [dias <= 4 ? "5d" : dias <= 27 ? "1mo" : "60d", "5m"] : k === "semanal" ? ["10y", "1wk"] : [dias < 690 ? "2y" : "5y", "1d"];
    let bars = [];
    try {
      const r = await fetch(`/api/cotacoes?s=${encodeURIComponent(simbolo(o))}&range=${range}&iv=${iv}&ohlc=1`).then(r => r.json());
      bars = (r.quotes?.[simbolo(o)]?.bars || []).map(([t, op, h, lo, c, v]) => ({ t, o: op, h, l: lo, c, v }));
    } catch {}
    // the same clock as the bot: Brasília time for 5-minute candles, the UTC date for daily and weekly ones
    const chave = b => intra ? new Date((b.t - 3 * 3600) * 1000).toISOString().slice(0, 16) : new Date(b.t * 1000).toISOString().slice(0, 10);
    const quando = x => x.data + (intra && x.hora ? "T" + x.hora : "");
    const achar = x => bars.findIndex(b => chave(b) >= quando(x));
    const iA = achar(ent), iF = sai ? achar(sai) : bars.length - 1;
    if (bars.length < 3 || iA < 0 || chave(bars[iA]).slice(0, 10) !== ent.data) {
      dlg.innerHTML = `<div class="card">${topo}<div class="empty">Os candles dessa data não estão mais disponíveis${intra ? " (o Yahoo guarda os de 5 minutos por cerca de 60 dias)" : ""}.</div></div>`; return;
    }
    const fim = iF < 0 ? bars.length - 1 : iF, M = intra ? 12 : 15;
    const de = Math.max(0, iA - M), ate = Math.min(bars.length, fim + M + 1), vis = bars.slice(de, ate);
    const C = bars.map(b => b.c), m9 = A.ema(C, 9), m21 = intra ? A.ema(C, 21) : A.sma(C, 21), n21 = intra ? "MME 21" : "MMS 21";
    const compra = l.compra, venda = l.venda ?? bars[fim].c, R = res?.regras || {};
    const alvo = intra && o.mercado !== "cripto" && R.dt_alvo_pct ? compra * (1 + R.dt_alvo_pct / 100) : null;
    const stop = intra && o.mercado !== "cripto" && R.dt_stop_pct ? compra * (1 - R.dt_stop_pct / 100) : null;
    // support and resistance as they stood when the trade opened: lowest low and highest high of the
    // 20 candles before the purchase (the same rule as the site's charts)
    const nSR = intra ? R.dt_sr_candles || 20 : 20, sr = iA >= 2 ? A.supportResistance(bars, nSR, iA - 1) : null;

    // the drawing
    const W = 820, H = 320, pL = 6, pR = 92, ax = 18, n = vis.length, step = (W - pL - pR) / n, X = j => pL + (j + 0.5) * step;
    const vals = vis.flatMap(b => [b.h, b.l]).concat([compra, venda, alvo, stop, sr?.suporte, sr?.resistencia].filter(v => v != null));
    let lo = Math.min(...vals), hi = Math.max(...vals); const pd = (hi - lo) * 0.08 || hi * 0.01; lo -= pd; hi += pd;
    const Y = v => 8 + (1 - (v - lo) / (hi - lo)) * (H - ax - 16);
    const f = v => nf(v < 1 ? 4 : 2).format(v);
    const linha = (arr, cor) => { let d = "", pen = false; for (let j = 0; j < n; j++) { const v = arr[de + j]; if (v == null) { pen = false; continue; } d += (pen ? "L" : "M") + X(j).toFixed(1) + " " + Y(v).toFixed(1); pen = true; } return `<path d="${d}" fill="none" stroke="${cor}" stroke-width="1.4"/>`; };
    const hor = (v, cor, txt, tr = "5 4") => v == null ? "" : `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="${cor}" stroke-dasharray="${tr}" stroke-width="${tr === "5 4" ? 1 : 1.6}"/><text x="${W - pR + 4}" y="${Y(v) + 4}" font-size="10.5" fill="${cor}">${txt}</text>`;
    const variosDias = chave(vis[0]).slice(0, 10) !== chave(vis.at(-1)).slice(0, 10);
    const hora = b => { const s = chave(b); return intra ? (variosDias ? dt(s.slice(0, 10)).slice(0, 5) + " " : "") + s.slice(11, 16) : dt(s.slice(0, 10)).slice(0, 5); };
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="bot-gsvg" role="img" aria-label="Gráfico da operação">`;
    svg += `<rect x="${X(iA - de) - step / 2}" y="0" width="${(fim - iA + 1) * step}" height="${H - ax}" fill="var(--accent)" opacity=".07"/>`;
    if (sr) svg += hor(sr.resistencia, "#dc2626", `R ${f(sr.resistencia)}`, "1 3") + hor(sr.suporte, "#16a34a", `S ${f(sr.suporte)}`, "1 3");
    svg += hor(alvo, "var(--up)", `alvo ${f(alvo)}`) + hor(stop, "var(--down)", `stop ${f(stop)}`) + hor(compra, "var(--muted)", `compra ${f(compra)}`);
    const cw = Math.max(1, Math.min(12, step * 0.66));
    vis.forEach((b, j) => { const cor = b.c >= b.o ? "var(--up)" : "var(--down)", x = X(j), t = Math.min(Y(b.o), Y(b.c));
      svg += `<line x1="${x}" x2="${x}" y1="${Y(b.h)}" y2="${Y(b.l)}" stroke="${cor}"/><rect x="${x - cw / 2}" y="${t}" width="${cw}" height="${Math.max(1, Math.abs(Y(b.o) - Y(b.c)))}" fill="${b.c >= b.o ? "var(--panel)" : cor}" stroke="${cor}"/>`; });
    svg += linha(m9, "#f59e0b") + linha(m21, "#8b5cf6");
    const seta = (j, v, cima, cor, txt) => { const x = X(j), y = Y(v); return cima
      ? `<path d="M${x} ${y + 4} l7 12 h-14 z" fill="${cor}"/><text x="${x}" y="${y + 28}" font-size="11" font-weight="700" fill="${cor}" text-anchor="middle">${txt}</text>`
      : `<path d="M${x} ${y - 4} l7 -12 h-14 z" fill="${cor}"/><text x="${x}" y="${y - 20}" font-size="11" font-weight="700" fill="${cor}" text-anchor="middle">${txt}</text>`; };
    svg += seta(iA - de, compra, true, "var(--up)", "Compra");
    if (sai) svg += seta(fim - de, venda, false, "var(--down)", "Venda");
    [0, Math.floor(n / 2), n - 1].forEach((j, q) => { svg += `<text x="${X(j)}" y="${H - 4}" font-size="10.5" fill="var(--faint)" text-anchor="${q === 0 ? "start" : q === 2 ? "end" : "middle"}">${hora(vis[j])}</text>`; });
    svg += `<text x="${pL + 4}" y="14" font-size="10.5" font-weight="600"><tspan fill="#f59e0b">MME 9</tspan> <tspan fill="#8b5cf6">${n21}</tspan></text></svg>`;

    // the story
    const dentro = bars.slice(iA, fim + 1), mx = Math.max(...dentro.map(b => b.h)), mn = Math.min(...dentro.map(b => b.l));
    const mfe = (mx / compra - 1) * 100, mae = (mn / compra - 1) * 100, bruto = (venda / compra - 1) * 100;
    const nb = fim - iA, dur = intra ? (nb * 5 >= 60 ? `${Math.floor(nb * 5 / 60)} h ${nb * 5 % 60 ? (nb * 5 % 60) + " min" : ""}` : `${Math.max(5, nb * 5)} minutos`) : `${nb} ${k === "semanal" ? (nb === 1 ? "semana" : "semanas") : nb === 1 ? "pregão" : "pregões"}`;
    const custos = (ent.custos_brl || 0) + (sai?.custos_brl || 0), r = sai?.resultado_brl, rp = sai?.resultado_pct;
    const mot = sai?.motivo || "", txt = [];
    txt.push(`<p><b>Entrada:</b> comprou ${qtd(ent.qtd, o.mercado)} a <b>${px(compra, o.mercado)}</b> em ${dt(ent.data)}${ent.hora ? " às " + ent.hora : ""}. Motivo: ${esc(ent.motivo)}.</p>`);
    txt.push(`<p><b>Durante a operação</b> (${dur}): o preço chegou a ${px(mx, o.mercado)} (<b>${pcT(mfe)}</b> sobre a compra) e desceu até ${px(mn, o.mercado)} (<b>${pcT(mae)}</b>).</p>`);
    if (sr) {
      const dR = (sr.resistencia / compra - 1) * 100, dS = (sr.suporte / compra - 1) * 100;
      txt.push(`<p><b>Suporte e resistência:</b> na hora da compra, a resistência (máxima dos ${nSR} candles anteriores) estava em ${px(sr.resistencia, o.mercado)}, ${dR > 0 ? `${nf(2).format(dR)}% acima do preço de compra` : "abaixo do preço de compra: a compra foi num rompimento da resistência"}, e o suporte (mínima) em ${px(sr.suporte, o.mercado)}, ${nf(2).format(Math.abs(dS))}% abaixo.${dR > 0 ? (mx > sr.resistencia ? " Durante a operação o preço passou da resistência." : " Durante a operação o preço não passou da resistência.") : ""}${mn < sr.suporte ? " O preço chegou a perder o suporte." : ""}</p>`);
    }
    if (!sai) txt.push(`<p><b>Ainda em andamento.</b> Pelo último candle, o preço está em ${px(venda, o.mercado)} (${pcT(bruto)} sobre a compra).</p>`);
    else {
      const saida = /^Resist/.test(mot) ? `<b>Saída na resistência:</b> o preço subiu até a resistência que valia na compra (a máxima recente), e a venda garantiu o ganho antes de um possível recuo.`
        : /^Alvo/.test(mot) ? `<b>Saída no alvo:</b> o preço subiu até o alvo de ganho e a venda garantiu o lucro.`
        : /^Stop/.test(mot) ? `<b>Saída no stop:</b> o preço caiu até o preço de proteção, e o stop limitou a perda.${mfe >= 0.5 ? ` Antes disso, a operação chegou a ficar ${pcT(mfe)} no positivo, mas o preço não alcançou o alvo e voltou.` : ""}`
        : /^Zerado/.test(mot) ? `<b>Encerrada no fim do dia:</b> ${o.mercado === "cripto" ? "na cripto o dia termina às 21h" : "no day trade nada fica aberto para o dia seguinte"}, então a posição foi vendida antes do fechamento, sem tocar nem o alvo nem o stop. O resultado é só o quanto o preço andou até ali.`
        : /^Limite de perda/.test(mot) ? `<b>Limite de perda do mês:</b> a carteira inteira caiu até o limite mensal, e o bot vendeu tudo, inclusive esta posição.`
        : /^Tempo/.test(mot) ? `<b>Tempo máximo:</b> a operação passou do número máximo de candles e foi encerrada.`
        : `<b>Sinal de saída:</b> ${esc(mot)}. A regra entende que o movimento de alta perdeu força.`;
      txt.push(`<p>${saida}</p>`);
      txt.push(`<p><b>Resultado:</b> o preço ${bruto >= 0 ? "subiu" : "caiu"} ${nf(2).format(Math.abs(bruto))}% entre a compra e a venda. Os custos (taxas e diferença de preço) somaram ${brl(custos)}. No fim: ${pc(rp)} (${brl(r)}).${bruto > 0 && r < 0 ? " O preço até subiu, mas tão pouco que os custos levaram o resultado para o negativo." : ""}${o.mercado !== "b3" ? " Em ativos em dólar, a variação do dólar no período também entra no resultado em reais." : ""}</p>`);
      const porque = r > 0
        ? (mae > -0.3 ? "O lucro veio de o preço ter subido logo depois do sinal de compra, quase sem andar contra a posição." : `O lucro veio de o preço ter subido depois do sinal, embora antes tenha chegado a ficar ${pcT(mae)} contra a posição.`)
        : (mfe < 0.2 ? "O prejuízo veio de o preço praticamente não ter subido depois da compra: o sinal de alta não se confirmou." : `O prejuízo veio de o preço ter subido pouco (no máximo ${pcT(mfe)}) e depois voltado para baixo do preço de compra.`);
      txt.push(`<p><b>Em resumo:</b> ${porque}</p>`);
      const dep = bars.slice(fim + 1, ate);
      if (dep.length) { const d2 = (dep.at(-1).c / venda - 1) * 100;
        txt.push(`<p><b>Depois da venda:</b> ${dep.length} ${intra ? "candles (" + dep.length * 5 + " min)" : k === "semanal" ? "semanas" : "pregões"} depois, o preço estava em ${px(dep.at(-1).c, o.mercado)} (${pcT(d2)} sobre a venda)${Math.abs(d2) < 0.2 ? "." : d2 > 0 ? ": quem tivesse segurado teria ganhado mais." : ": a venda evitou essa queda."}</p>`); }
    }
    if (intra && o.mercado !== "cripto") {
      const dia = bars.filter(b => chave(b).slice(0, 10) === ent.data);
      if (dia.length) txt.push(`<p class="hint">No dia, ${esc(o.ticker)} foi de ${px(dia[0].o, o.mercado)} na abertura a ${px(dia.at(-1).c, o.mercado)} no último candle (${pcT((dia.at(-1).c / dia[0].o - 1) * 100)}).</p>`);
    }
    dlg.innerHTML = `<div class="card">${topo}${svg}
      <p class="hint">Faixa colorida: o tempo em que a posição ficou aberta. ${sr ? "Linhas pontilhadas S e R: suporte e resistência na hora da compra (mínima e máxima dos ${nSR} candles anteriores). " : ""}${alvo ? "Alvo e stop pelas regras atuais. " : ""}${M} candles antes da compra e depois da venda.</p>
      <h4>📝 Por que deu ${!sai ? "esse resultado até agora" : r > 0 ? "lucro" : "prejuízo"}</h4>${txt.join("")}
      <p class="hint">Análise automática e descritiva, feita a partir dos candles. Não é recomendação de investimento.</p></div>`;
  }

  // the months in which the loss limit stopped the bot (from the trades it closed because of it)
  function limiteHTML(m, k) {
    const L = res?.regras?.perda_mensal_pct; if (!L) return "";
    const hoje = k === "daytrade" && vivo?.ops ? vivo.ops : [];
    const dias = new Map();
    for (const o of [...hoje, ...m.operacoes]) if (/^Limite de perda do mês/.test(o.motivo) && !dias.has(o.data.slice(0, 7))) dias.set(o.data.slice(0, 7), o.data);
    if (!dias.size && !(k === "daytrade" && vivo?.travado)) return `<p class="hint">🛡️ Limite de perda no mês: −${num(L)}%. Ainda não foi atingido.</p>`;
    const mes = ym => new Date(ym + "-15T12:00:00Z").toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "");
    const agora = hojeBR().slice(0, 7), parado = dias.has(agora) || (k === "daytrade" && vivo?.travado);
    return `<p class="${parado ? "note" : "hint"}">🛡️ Limite de perda no mês (−${num(L)}%) atingido em: ${[...dias.values()].sort().map(d => `${mes(d.slice(0, 7))} (dia ${dt(d).slice(0, 5)})`).join(", ") || "hoje"}.${parado ? " <b>Neste mês o bot está parado</b> e volta a operar no dia 1º." : ""}</p>`;
  }

  // the rules in force, in words
  function regrasHTML(r, k) {
    if (!r?.regras) return "";
    const g = r.regras, f = r.fixos, merc = g.mercados.map(m => ({ b3: `${r.universo.b3} ações da B3 (Ibovespa)`, eua: `${r.universo.eua} dos EUA (sua lista)`, cripto: `as criptomoedas ${r.universo.cripto.join(", ")}` })[m]);
    const custos = `<li><b>Custos:</b> ${nf(2).format(f.custos.b3 * 100)}% por operação na B3, ${nf(1).format(f.custos.eua * 100)}% nos EUA e em cripto, e cada execução ${nf(2).format(f.deslize * 100)}% pior que o preço do sinal. Ativos em dólar são convertidos pela cotação do dia. <b>Imposto de renda, IOF e dividendos não estão incluídos.</b></li>`;
    const itens = k === "daytrade" ? `
      <li><b>Ativos:</b> as ${res.modos.daytrade?.ativos?.b3 ?? g.dt_b3_top} ações de maior peso no Ibovespa${g.mercados.includes("eua") ? ", as ações dos EUA da sua lista" : ""}${g.mercados.includes("cripto") ? " e as criptomoedas" : ""}, em candles de 5 minutos.</li>
      <li><b>Ações — compra</b> ${[g.dt_comprar_cruzamento && `quando a MME 9 cruza acima da MME 21${g.dt_vwap ? " com o preço acima da VWAP (preço médio do dia)" : ""}`, g.dt_comprar_suporte && `quando um candle toca o <b>suporte</b> (mínima dos ${g.dt_sr_candles} candles anteriores) e fecha acima dele`].filter(Boolean).join(", ou ") || "<b>nunca</b> (nenhum sinal de compra está ligado)"}, depois dos primeiros ${g.dt_inicio_min} minutos e até ${g.dt_ultima_min} minutos antes do fechamento.</li>
      <li><b>Ações — vende</b> ${g.dt_vender_resistencia ? `na <b>resistência</b> (máxima dos ${g.dt_sr_candles} candles anteriores ao sinal, se estiver abaixo do alvo), ` : ""}no alvo (+${num(g.dt_alvo_pct)}%), no stop (−${num(g.dt_stop_pct)}%)${g.dt_sair_cruzamento ? ", quando a MME 9 cruza abaixo da MME 21" : ""} ou ${g.dt_zerar_min} minutos antes do fechamento.</li>
      ${g.dt_volume ? `<li><b>Volume:</b> só compra se o volume do candle do sinal for maior que a média dos ${g.dt_volume_n} candles anteriores (ações e cripto).</li>` : ""}
      <li><b>Cripto — compra</b> depois de um candle de alta com corpo ${num(g.dtc_mult)}× maior que a média dos ${g.dtc_media} anteriores. <b>Vende</b> no stop (mínima desse candle), no alvo (${num(g.dtc_rr)}× o risco), depois de ${g.dtc_max_candles} candles, ou às 21h (fim do dia em UTC).</li>
      ${g.perda_mensal_pct > 0 ? `<li><b>Limite de perda no mês:</b> se o patrimônio cair ${num(g.perda_mensal_pct)}% desde o início do mês, vende tudo na hora e não opera mais até o mês seguinte.</li>` : ""}
      <li><b>Tamanho:</b> até ${g.dt_max_posicoes} posições ao mesmo tempo, cada uma com cerca de 1/${g.dt_max_posicoes} do patrimônio. Se o stop e o alvo forem tocados no mesmo candle, conta o stop (a hipótese mais cautelosa).</li>`
      : `
      <li><b>Ativos:</b> ${merc.join(", ")}.</li>
      <li><b>Compra</b> quando a pontuação técnica é +${g.pontuacao_min} ou mais (a mesma do relatório) e a tendência não é de baixa${g.evitar_conflito ? ", sem sinal de alta e de baixa ao mesmo tempo" : ""}. Se há mais candidatos que espaço, entram os de maior pontuação.</li>
      <li><b>Vende</b> ${[g.vender_tendencia && "quando a tendência vira de baixa", g.vender_vies && "quando o viés vira de baixa", `quando o preço toca o <b>stop</b>: começa ${num(g.stop_atr)} ATR abaixo do preço de compra${g.trailing_atr > 0 ? ` e sobe junto com o preço (${num(g.trailing_atr)} ATR abaixo do maior fechamento)` : ""}`].filter(Boolean).join(", ")}. ATR é o tamanho médio do movimento de um candle.</li>
      <li><b>Tamanho:</b> até ${g.max_posicoes} posições, cada uma com cerca de 1/${g.max_posicoes} do patrimônio. Depois de vender, espera ${g.espera_diario} pregões (diário) ou ${g.espera_semanal} semanas (semanal) para comprar o mesmo ativo de novo.</li>
      ${g.perda_mensal_pct > 0 ? `<li><b>Limite de perda no mês:</b> se, num fechamento, o patrimônio estiver ${num(g.perda_mensal_pct)}% abaixo do início do mês, vende tudo na abertura seguinte e não compra mais até o mês seguinte.</li>` : ""}
      <li><b>Sem olhar o futuro:</b> decide com o candle já fechado e executa na abertura do candle seguinte.</li>`;
    return `<details class="card bot-regras"><summary><b>📏 Regras em uso (${NOMES[k]})</b></summary><ul>${itens}${custos}</ul></details>`;
  }

  function render() {
    if (!box) return;
    if (!carregado) { box.innerHTML = `<div class="empty">Carregando…</div>`; return; }
    const u = ui(), modos = res?.modos ? MODOS.filter(k => res.modos[k] && (cfg?.modos?.includes(k) ?? true)) : [];
    const k = modos.includes(u.modo) ? u.modo : modos[0];
    const espera = aguardando ? `<div class="note">⏳ Simulando… o bot leva uns 3 a 5 minutos para refazer as contas e publicar. Esta página atualiza sozinha.</div>` : "";
    let corpo = "";
    if (!cfg) corpo = `<div class="empty">Escolha o valor inicial e o modo acima para o bot começar.</div>`;
    else if (!k) corpo = aguardando ? "" : `<div class="empty">Ainda não há resultado. Ele aparece alguns minutos depois de salvar.</div>`;
    else {
      const comp = modos.length > 1 ? `<div class="card scroll"><table class="grid"><thead><tr><th>Modelo</th><th>Patrimônio</th><th>Retorno</th><th>Ibovespa</th><th>CDI</th><th>Maior queda</th><th>Operações</th><th>Com lucro</th><th>Período</th></tr></thead><tbody>
        ${modos.map(x => { const m = res.modos[x], p = m.placar; return `<tr data-bot-modo="${x}"><td><b>${NOMES[x]}</b></td><td>${brl(m.patrimonio)}</td><td>${pc(p.retorno_pct)}</td><td>${pc(p.ibov_pct)}</td><td>${pc(p.cdi_pct)}</td><td>${pc(p.queda_maxima_pct)}</td><td>${p.operacoes}</td><td>${p.acerto_pct == null ? "—" : nf(1).format(p.acerto_pct) + "%"}</td><td>${dt(m.inicio)} a ${dt(m.ultimo_candle)}</td></tr>`; }).join("")}</tbody></table></div>
        <p class="hint">O day trade começa mais tarde porque só há cerca de 60 dias de candles de 5 minutos; compare os retornos sabendo disso.</p>` : "";
      corpo = `${comp}${modos.length > 1 ? `<div class="ftabs" role="tablist" style="margin-top:12px">${modos.map(x => `<button role="tab" data-bot-modo="${x}" aria-selected="${x === k}">${NOMES[x]}</button>`).join("")}</div>` : `<h4 class="sec-t">${NOMES[k]}</h4>`}
        ${modoHTML(k, res.modos[k])}${regrasHTML(res, k)}`;
    }
    box.innerHTML = `${setup()}${espera}${corpo}
      <p class="note" style="margin-top:14px">Simulação com dinheiro imaginário, para estudar como regras de análise técnica teriam se saído. Não é recomendação de investimento, e resultado passado não garante resultado futuro.</p>`;
  }

  async function salvar() {
    const f = form(), v = Math.round(lerReais(f.valor) * 100) / 100, m = $("#botMsg");
    if (!(v >= 100)) { m.textContent = "Digite um valor inicial de pelo menos R$ 100."; return; }
    if (!f.escolha) { m.textContent = "Escolha o modo."; return; }
    if (SPEC && !f.regras.mercados?.length) { m.textContent = "Escolha pelo menos um mercado."; return; }
    const modos = f.escolha === "todos" ? MODOS : [f.escolha];
    m.textContent = "Salvando…";
    try {
      const r = await fetch("/api/preferencias", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot: { valor_inicial: v, modos, ...(SPEC ? { regras: f.regras } : {}), reiniciar: !!$("#botReiniciar")?.checked } }) });
      const j = await r.json(); if (!r.ok || j.erro) throw new Error(j.erro || r.status);
      cfg = j.bot; rascunho = null; msg = j.mudou ? "" : "Nada mudou.";
      if (j.mudou) { aguardando = new Date().toISOString(); aberto = { ...aberto, setup: false }; acompanhar(); }
      render();
    } catch (e) { m.textContent = "Não consegui salvar: " + e.message; }
  }
  // after saving, check every 30 s (up to 10 min) until the new result is published
  function acompanhar() {
    let n = 0; const t = setInterval(() => { if (!aguardando || ++n > 20) { clearInterval(t); if (aguardando) { aguardando = null; msg = "A simulação está demorando; volte daqui a pouco."; render(); } return; } carregar(); }, 30000);
  }

  async function csv(k) {
    const m = res.modos[k], q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
    let ops = [...m.operacoes].reverse();
    // day trade: the whole history is kept in one file per month
    if (m.meses?.length) ops = (await Promise.all(m.meses.map(x => fetch(`/relatorios/bot/daytrade/ops-${x}.json`).then(r => r.ok ? r.json() : []).catch(() => [])))).flat();
    const pares = parear(ops);
    const linhas = [["data", "hora", "ativo", "mercado", "operacao", "status", "motivo_saida", "posicao", "quantidade", "preco", "preco_compra", "preco_venda", "valor_brl", "custos_brl", "resultado_brl", "resultado_pct", "teste", "motivo"].join(";"),
      ...ops.map(o => { const p = pares.get(o), l = pernas(p); return [o.data, o.hora || "", o.ticker, o.mercado, o.lado, p.fecha ? "encerrada" : "aberta", l.motivo || "", p.vendida ? "vendida" : "comprada", o.qtd, o.preco, l.compra ?? "", l.venda ?? "", o.valor_brl, o.custos_brl, o.resultado_brl ?? "", o.resultado_pct ?? "", o.teste ? "sim" : "não", q(o.motivo)].join(";").replace(/(\d)\.(\d)/g, "$1,$2"); })];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `bot-${k}-historico.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // typing in the form keeps a draft, so a refresh of the results does not erase it
  box?.addEventListener("input", e => {
    if (e.target.dataset?.botData) return;          // the history date filter is not part of the form
    const t = e.target, f = rascunho || (rascunho = structuredClone(form()));
    if (t.id === "botValor") f.valor = t.value;
    if (t.name === "botModo") f.escolha = t.value;
    const k = t.dataset.regra; if (!k || !SPEC) return;
    const x = SPEC.REGRAS.find(r => r.k === k);
    if (x.tipo === "bool") f.regras[k] = t.checked;
    else if (x.tipo === "lista") f.regras[k] = [...box.querySelectorAll(`[data-regra="${k}"]:checked`)].map(i => i.value);
    else if (t.value !== "") f.regras[k] = +t.value;
  });
  // out-of-range numbers are brought back into range when the field is left
  box?.addEventListener("change", e => {
    const dd = e.target.dataset?.botData;
    if (dd) { const [de, ate] = faixa(ui()); verMais = PAGINA; return setUi({ periodo: "datas", de, ate, [dd]: e.target.value }); }
    // the value is written back in reais when the field is left
    if (rascunho && (e.target.name === "botModo" || e.target.dataset?.regra === "mercados")) return render();
    if (e.target.id === "botValor" && rascunho) { const v = lerReais(e.target.value); if (Number.isFinite(v)) e.target.value = rascunho.valor = emReais(v); return; }
    const k = e.target.dataset?.regra; if (!k || !SPEC || !rascunho) return;
    const ok = SPEC.normalizar({ ...rascunho.regras, mercados: rascunho.regras.mercados?.length ? rascunho.regras.mercados : ["b3"] });
    if (e.target.type === "number") { rascunho.regras[k] = ok[k]; e.target.value = ok[k]; }
    if (k === "historico_meses") render();       // the start date written under the field
  });
  box?.addEventListener("toggle", e => { const d = e.target.closest?.("[data-bot-fold]"); if (d) aberto = { ...aberto, [d.dataset.botFold]: d.open }; }, true);
  box?.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("#botSalvar")) return salvar();
    if (t.closest("#botPadrao")) { rascunho = { ...structuredClone(form()), regras: SPEC.padrao() }; return render(); }
    const gf = t.closest("[data-bot-graf]"); if (gf) return graficoOperacao(+gf.dataset.botGraf);
    if (t.closest("#botMais")) { verMais += PAGINA; return render(); }
    const md = t.closest("[data-bot-modo]"); if (md) { verMais = PAGINA; return setUi({ modo: md.dataset.botModo }); }
    const mc = t.closest("[data-bot-merc]"); if (mc) { verMais = PAGINA; return setUi({ merc: mc.dataset.botMerc }); }
    const pr = t.closest("[data-bot-periodo]"); if (pr) { verMais = PAGINA; return setUi({ periodo: pr.dataset.botPeriodo }); }
    const ld = t.closest("[data-bot-lado]"); if (ld) { verMais = PAGINA; return setUi({ lado: ld.dataset.botLado }); }
    const rs = t.closest("[data-bot-res]"); if (rs) { verMais = PAGINA; return setUi({ res: rs.dataset.botRes }); }
    const c = t.closest("[data-bot-csv]"); if (c) return csv(c.dataset.botCsv);
  });

  // live day trade: refreshed every minute while the bot is on screen, never while the user types in the form
  setInterval(async () => {
    if (!res?.modos?.daytrade || !box?.offsetParent || document.hidden) return;
    await aoVivo();
    const foco = document.activeElement;
    if (!(foco && box.contains(foco) && /INPUT|SELECT|TEXTAREA/.test(foco.tagName))) render();
  }, 60000);

  // Carteira sub-tabs
  const cartSub = () => { try { const s = localStorage.getItem(KEY + ".csub"); return ["favs", "minha", "bot"].includes(s) ? s : "favs"; } catch { return "favs"; } };
  window.showCartSub = (name = cartSub()) => {
    document.querySelectorAll("[data-csub]").forEach(b => b.setAttribute("aria-selected", b.dataset.csub === name));
    document.querySelectorAll("[data-csub-panel]").forEach(p => p.hidden = p.dataset.csubPanel !== name);
    try { localStorage.setItem(KEY + ".csub", name); } catch {}
    if (name === "bot" && !carregado) { render(); carregar(); }
  };
  document.querySelector(".csubs")?.addEventListener("click", e => { const b = e.target.closest("[data-csub]"); if (b) window.showCartSub(b.dataset.csub); });
  window.showCartSub();
})();
