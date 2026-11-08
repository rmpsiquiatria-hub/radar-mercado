// The simulated bot's buy and sell rules: one list shared by the site (the form in Carteira → Bot),
// the API that saves the choice (api/preferencias.js) and the bot itself (scripts/bot.mjs), so
// the defaults and the allowed ranges live in one place.

export const GRUPOS = {
  risco: "Proteção",
  geral: "Diário e semanal",
  dt: "Day trade · ações (B3 e EUA)",
  dtc: "Day trade · cripto (tamanho do candle)",
  dtx: "Day trade · filtros de entrada (ações e cripto)",
};

export const REGRAS = [
  // daily and weekly charts
  { k: "pontuacao_min", g: "geral", label: "Pontuação técnica mínima para comprar", min: 1, max: 8, passo: 1, padrao: 3,
    ajuda: "A mesma pontuação do relatório: tendência vale 2, golden cross 2, os demais sinais 1. Quanto maior, mais exigente." },
  // the averages of the technical score (tipo "media": [mme | mms, period])
  { k: "mm_curta", g: "geral", tipo: "media", label: "Média curta (cruzamento de curto prazo)", min: 2, max: 100, padrao: ["mme", 9] },
  { k: "mm_media", g: "geral", tipo: "media", label: "Média longa do cruzamento de curto prazo", min: 3, max: 150, padrao: ["mms", 21],
    ajuda: "O cruzamento da média curta com esta vale ±1 na pontuação." },
  { k: "mm_rapida", g: "geral", tipo: "media", label: "Média de tendência rápida", min: 5, max: 150, padrao: ["mms", 50] },
  { k: "mm_lenta", g: "geral", tipo: "media", label: "Média de tendência lenta", min: 20, max: 250, padrao: ["mms", 200],
    ajuda: "Tendência de alta = preço acima da rápida e rápida acima da lenta (±2). O cruzamento da rápida com a lenta é o cruzamento dourado / da morte (±2)." },
  { k: "max_posicoes", g: "geral", label: "Máximo de posições ao mesmo tempo", min: 1, max: 20, passo: 1, padrao: 6,
    ajuda: "O dinheiro é dividido em partes iguais entre elas." },
  { k: "stop_atr", g: "geral", label: "Stop inicial (× ATR abaixo da compra)", min: 0.5, max: 10, passo: 0.5, padrao: 2,
    ajuda: "ATR é o tamanho médio do movimento de um candle. 2 = vende se cair 2 movimentos médios." },
  { k: "trailing_atr", g: "geral", label: "Stop móvel (× ATR abaixo do maior fechamento; 0 = desligado)", min: 0, max: 10, passo: 0.5, padrao: 3,
    ajuda: "O stop sobe junto com o preço para proteger o lucro." },
  { k: "espera_diario", g: "geral", label: "Espera para recomprar o mesmo ativo (pregões, gráfico diário)", min: 0, max: 60, passo: 1, padrao: 5 },
  { k: "espera_semanal", g: "geral", label: "Espera para recomprar o mesmo ativo (semanas, gráfico semanal)", min: 0, max: 26, passo: 1, padrao: 2 },
  { k: "vender_vies", g: "geral", tipo: "bool", label: "Vender quando o viés técnico vira de baixa", padrao: true },
  { k: "vender_tendencia", g: "geral", tipo: "bool", label: "Vender quando a tendência vira de baixa", padrao: true },
  { k: "evitar_conflito", g: "geral", tipo: "bool", label: "Não operar ativo com sinal de alta e de baixa ao mesmo tempo", padrao: true },
  // shown on its own at the top of the form, not inside a group
  { k: "mercados", g: "mercados", tipo: "lista", label: "Em quais mercados o bot opera", opcoes: [["b3", "Ações do Brasil (B3)"], ["eua", "Ações dos EUA"], ["cripto", "Criptomoedas"]], padrao: ["b3", "eua", "cripto"],
    ajuda: "Vale para todos os modos. Marque pelo menos um." },
  // also on its own at the top: how far before the activation date the back test starts
  { k: "historico_meses", g: "periodo", label: "Tamanho do teste no passado", min: 1, max: 36, passo: 1, padrao: 12,
    ajuda: "Meses antes da data de início da simulação. O day trade só tem cerca de 60 dias de candles de 5 minutos, então o teste dele nunca vai mais longe que isso." },

  // every mode: a stop for the whole month
  { k: "perda_mensal_pct", g: "risco", label: "Limite de perda no mês (%)", min: 0, max: 50, passo: 0.5, padrao: 6,
    ajuda: "Se o patrimônio cair este tanto desde o início do mês, o bot vende tudo e só volta a operar no mês seguinte. 0 = sem limite." },

  // day trade, stocks: 5-minute candles, short average crossing the long one above the VWAP
  { k: "dt_alvo_pct", g: "dt", label: "Alvo de lucro (%)", min: 0.2, max: 20, passo: 0.1, padrao: 2 },
  { k: "dt_stop_pct", g: "dt", label: "Stop de perda (%)", min: 0.2, max: 20, passo: 0.1, padrao: 1 },
  { k: "dt_max_posicoes", g: "dt", label: "Máximo de posições ao mesmo tempo", min: 1, max: 20, passo: 1, padrao: 5 },
  { k: "dt_inicio_min", g: "dt", label: "Não entrar nos primeiros (minutos do pregão)", min: 0, max: 120, passo: 5, padrao: 15 },
  { k: "dt_ultima_min", g: "dt", label: "Última entrada (minutos antes do fechamento)", min: 0, max: 240, passo: 5, padrao: 60 },
  { k: "dt_zerar_min", g: "dt", label: "Zerar tudo (minutos antes do fechamento)", min: 5, max: 60, passo: 5, padrao: 15 },
  { k: "dt_b3_top", g: "dt", label: "Ações da B3 operadas (as N de maior peso no Ibovespa)", min: 5, max: 80, passo: 1, padrao: 30,
    ajuda: "Day trade precisa de muita liquidez: as maiores do índice." },
  { k: "dt_vwap", g: "dt", tipo: "bool", label: "Só comprar com o preço acima da VWAP (preço médio do dia)", padrao: true },
  { k: "dt_mm_curta", g: "dt", tipo: "media", label: "Média curta (candles de 5 min)", min: 2, max: 100, padrao: ["mme", 9] },
  { k: "dt_mm_longa", g: "dt", tipo: "media", label: "Média longa (candles de 5 min)", min: 3, max: 200, padrao: ["mme", 21] },
  { k: "dt_sair_cruzamento", g: "dt", tipo: "bool", label: "Vender quando a média curta cruza de volta abaixo da longa", padrao: true },
  { k: "dt_comprar_cruzamento", g: "dt", tipo: "bool", label: "Comprar quando a média curta cruza acima da longa", padrao: true },
  { k: "dt_comprar_suporte", g: "dt", tipo: "bool", label: "Comprar quando o preço toca o suporte e fecha acima dele (o suporte segurou)", padrao: true },
  { k: "dt_vender_resistencia", g: "dt", tipo: "bool", label: "Vender quando o preço atinge a resistência (a que valia na compra)", padrao: true },
  { k: "dt_ibov", g: "dt", tipo: "bool", label: "Ações da B3: só operar na direção do Ibovespa", padrao: false,
    ajuda: "Só compra com o Ibovespa em alta no dia (acima do fechamento do dia anterior). Não afeta ações dos EUA nem cripto." },
  { k: "dt_vendido", g: "dt", tipo: "bool", label: "Com o Ibovespa em queda, operar vendido (sem isso, o bot fica de fora)", padrao: true,
    ajuda: "Só vale com a opção acima ligada. Usa as mesmas regras, espelhadas: vende quando a média curta cruza abaixo da longa ou quando o preço toca a resistência e fecha abaixo dela, e recompra no stop (acima), no alvo (abaixo) ou no suporte." },
  { k: "dt_sr_candles", g: "dt", label: "Suporte e resistência: mínima e máxima dos últimos (candles de 5 min)", min: 5, max: 100, passo: 1, padrao: 20,
    ajuda: "20 candles = 1 hora e 40 minutos." },

  // day trade, stocks and crypto: only enter on a candle with more volume than usual
  { k: "dt_volume", g: "dtx", tipo: "bool", label: "Só comprar se o volume do candle do sinal for maior que a média", padrao: true },
  { k: "dt_volume_n", g: "dtx", label: "Média de volume dos últimos (candles de 5 min)", min: 5, max: 100, passo: 1, padrao: 20 },
  // a time of day when no trade is opened (lunch, for example)
  { k: "dt_pausa", g: "dtx", tipo: "bool", label: "Ter um intervalo sem novas operações", padrao: false,
    ajuda: "Durante o intervalo o bot não abre operações. As já abertas continuam protegidas: stop, alvo, resistência e o zeramento do fim do dia seguem valendo." },
  { k: "dt_pausa_ini", g: "dtx", tipo: "hora", label: "Início do intervalo (horário de Brasília)", padrao: "12:00" },
  { k: "dt_pausa_fim", g: "dtx", tipo: "hora", label: "Fim do intervalo (horário de Brasília)", padrao: "13:00" },

  // day trade, crypto: a candle much bigger than usual, closing up
  { k: "dtc_mult", g: "dtc", label: "Tamanho do candle para comprar (× o tamanho médio)", min: 1, max: 10, passo: 0.1, padrao: 2.5,
    ajuda: "Compra quando um candle de 5 minutos de alta tem o corpo este tanto maior que a média recente." },
  { k: "dtc_media", g: "dtc", label: "Média de quantos candles anteriores", min: 5, max: 100, passo: 1, padrao: 20 },
  { k: "dtc_rr", g: "dtc", label: "Alvo (× o risco até o stop)", min: 0.5, max: 10, passo: 0.5, padrao: 2,
    ajuda: "O stop fica na mínima do candle que deu o sinal; o alvo é este múltiplo da distância até ele." },
  { k: "dtc_max_candles", g: "dtc", label: "Tempo máximo na operação (candles de 5 min)", min: 1, max: 288, passo: 1, padrao: 12 },
];

// Fills in the defaults and clamps every value into its range, so anything saved is valid.
export function normalizar(r = {}) {
  const out = {};
  for (const x of REGRAS) {
    const v = r?.[x.k];
    if (x.tipo === "bool") out[x.k] = typeof v === "boolean" ? v : x.padrao;
    else if (x.tipo === "media") {
      const t = Array.isArray(v) && (v[0] === "mme" || v[0] === "mms") ? v[0] : x.padrao[0], n = Number(Array.isArray(v) ? v[1] : NaN);
      out[x.k] = [t, Number.isFinite(n) ? Math.min(x.max, Math.max(x.min, Math.round(n))) : x.padrao[1]];
    }
    else if (x.tipo === "hora") out[x.k] = typeof v === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v) ? v : x.padrao;
    else if (x.tipo === "lista") { const ok = x.opcoes.map(o => o[0]); out[x.k] = Array.isArray(v) && v.some(y => ok.includes(y)) ? ok.filter(y => v.includes(y)) : x.padrao; }
    else { const n = Number(v); out[x.k] = Number.isFinite(n) ? Math.min(x.max, Math.max(x.min, Math.round(n / x.passo) * x.passo)) : x.padrao; out[x.k] = +out[x.k].toFixed(4); }
  }
  return out;
}
export const padrao = () => normalizar({});
// "MME 9", "MMS 21" (null for a result published before the averages were a rule)
export const nomeMedia = m => Array.isArray(m) ? `${m[0] === "mme" ? "MME" : "MMS"} ${m[1]}` : null;
