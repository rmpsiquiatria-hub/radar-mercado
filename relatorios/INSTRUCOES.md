# Relatório fundamentalista diário — instruções para o Claude

Você gera, uma vez por dia útil, o relatório que aparece na aba "Relatório diário" do site
Radar do Mercado (radar-mercado-xi.vercel.app). O site só lê arquivos JSON deste diretório.

## Moldura obrigatória

- O relatório **resume o que fontes publicadas dizem**. Ele não dá recomendação própria.
  Nunca escreva "compre", "venda", "vale a pena" em nome próprio. Escreva como as fontes:
  "XP e BTG recomendam compra, com preço-alvo médio de R$ 45" ou "o Valor relata queda de 12% no lucro".
- Toda afirmação sobre opinião de analista precisa de fonte (nome + link) no campo `fontes`.
- Não invente números. Se não achou preço-alvo ou recomendação, use `null` / 0.
- Os sinais de "compra" e "atenção" do site são calculados pela página a partir do consenso das
  fontes + critérios que o usuário escolhe. Seu trabalho é preencher os dados com precisão.

## Passo a passo

1. Atualize os indicadores: `node scripts/indicadores.mjs`
   (gera `relatorios/indicadores.json` com Ibovespa do dia + `relatorios/acompanhar.json`).
2. Leia `relatorios/ultimo.json` (relatório anterior, se existir). Para cada empresa, a pesquisa
   anterior é o ponto de partida: atualize só o que mudou e mantenha o resto, ajustando `atualizado_em`
   somente quando houver informação nova.
3. Pesquise as empresas em **lotes paralelos** (subagentes, ~10 empresas por lote), considerando
   apenas o que foi publicado nos últimos 30 dias, com prioridade para as últimas 48 horas.
   Fontes preferidas (fundamentalistas / recomendações):
   InfoMoney, Valor Econômico (Valor Investe), Money Times, Exame Invest, Seu Dinheiro,
   Inteligência Financeira, Suno Notícias, E-Investidor (Estadão), Bloomberg Línea, Brazil Journal,
   Status Invest / Investidor10 (indicadores e carteiras), relatórios e carteiras recomendadas
   divulgados por corretoras e bancos (XP, BTG Pactual, Itaú BBA, Safra, Genial, Ágora/Bradesco BBI,
   Santander, Goldman Sachs, JPMorgan, Morgan Stanley, UBS BB) quando noticiados.
   Para ações dos EUA: Reuters, CNBC, MarketWatch, Barron's, Yahoo Finance, Seeking Alpha (notícias).
   Para cada empresa, procure: recomendação e preço-alvo de cada casa (com data), mudanças recentes
   (elevação, rebaixamento, início de cobertura), resultado trimestral mais recente e como foi recebido,
   dividendos anunciados, fatos relevantes, riscos citados.
4. Monte `relatorios/ultimo.json` no formato abaixo e copie o mesmo conteúdo para
   `relatorios/historico/AAAA-MM-DD.json`.
5. Valide: `node scripts/validar-relatorio.mjs` (precisa terminar sem erros).
6. Faça commit (`Relatório diário AAAA-MM-DD`) e `git push` para `main`. O Vercel publica sozinho.

## Formato de `relatorios/ultimo.json`

```json
{
  "data": "2026-10-26",
  "gerado_em": "2026-10-26T07:12:00-03:00",
  "resumo_mercado": "3 a 4 frases curtas (máximo 600 caracteres) sobre o que move a bolsa brasileira e a americana hoje, segundo as fontes.",
  "empresas": [
    {
      "ticker": "PETR4",
      "nome": "Petrobras",
      "bolsa": "B3",
      "origem": ["ibovespa"],
      "peso_ibov": 9.015,
      "indicadores": { "...": "copiado de indicadores.json, sem alterar" },
      "resumo": "2 a 4 frases: o que as fontes dizem sobre fundamentos, resultado recente e perspectivas.",
      "sentimento": "positivo | neutro | negativo  (tom predominante das fontes, não sua opinião)",
      "consenso": {
        "compra": 5, "neutro": 2, "venda": 0,
        "preco_alvo_medio": 48.5, "moeda": "BRL",
        "casas": [ { "nome": "XP", "recomendacao": "compra", "preco_alvo": 50, "data": "2026-10-10" } ]
      },
      "mudancas": [
        { "tipo": "elevacao | rebaixamento | inicio_cobertura | resultado | dividendos | fato_relevante | outro",
          "descricao": "BTG elevou para compra após resultado do 3º tri.", "fonte": "Money Times", "data": "2026-10-25" }
      ],
      "fontes": [ { "nome": "InfoMoney", "titulo": "…", "url": "https://…", "data": "2026-10-25" } ],
      "atualizado_em": "2026-10-26"
    }
  ]
}
```

Regras do formato:
- Uma entrada por empresa de `indicadores.json`, na mesma ordem.
- `consenso.compra/neutro/venda` contam casas distintas (a recomendação mais recente de cada uma,
  dos últimos 6 meses). "Outperform/overweight/acima da média" = compra;
  "market perform/equal weight/neutro/manter" = neutro; "underperform/underweight/venda" = venda.
- `mudancas` só com eventos dos últimos 7 dias; pode ser lista vazia.
- Datas no formato AAAA-MM-DD. Links completos e reais (que você abriu ou viu no resultado da busca).
