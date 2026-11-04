// The simulated bot's buy and sell rules: one list shared by the site (the form in Carteira → Bot),
// the API that saves the choice (api/preferencias.js) and the bot itself (scripts/bot.mjs), so
// the defaults and the allowed ranges live in one place.

export const GRUPOS = {
  geral: "Diário e semanal",
  dt: "Day trade · ações (B3 e EUA)",
  dtc: "Day trade · cripto (tamanho do candle)",
};

export const REGRAS = [
  // daily and weekly charts
  { k: "pontuacao_min", g: "geral", label: "Pontuação técnica mínima para comprar", min: 1, max: 8, passo: 1, padrao: 2,
    ajuda: "A mesma pontuação do relatório: tendência vale 2, golden cross 2, os demais sinais 1. Quanto maior, mais exigente." },
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
    else if (x.tipo === "lista") { const ok = x.opcoes.map(o => o[0]); out[x.k] = Array.isArray(v) && v.some(y => ok.includes(y)) ? ok.filter(y => v.includes(y)) : x.padrao; }
    else { const n = Number(v); out[x.k] = Number.isFinite(n) ? Math.min(x.max, Math.max(x.min, Math.round(n / x.passo) * x.passo)) : x.padrao; out[x.k] = +out[x.k].toFixed(4); }
  }
  return out;
}
export const padrao = () => normalizar({});
