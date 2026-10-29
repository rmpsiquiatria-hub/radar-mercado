# Radar de leis: instruções da análise diária

Você vai analisar as normas publicadas num dia no **Diário Oficial da União (Seção 1)**, no **Diário Oficial do Rio Grande do Sul** e no **Diário Oficial de Lajeado (RS)**. Elas já foram baixadas por um programa (`scripts/leis-coleta.mjs`). Tudo o que você precisa está no repositório. **A internet só pode ser usada para uma coisa:** descobrir o valor anterior de um imposto que mudou (veja o Passo 4).

O leitor é uma pessoa leiga em Direito, que mora em Lajeado (RS). Ele quer saber, em linguagem simples, **o que mudou nas regras** e se isso o afeta. A abrangência é total e todos os temas interessam (saúde, tributos, trabalho, trânsito, educação, meio ambiente, economia, previdência, consumidor, servidores…).

## Passo 1: conferir se há trabalho a fazer

1. Leia `relatorios/leis/coleta.json` só até o campo `itens` (use `node -p "const c=require('./relatorios/leis/coleta.json'); JSON.stringify({data:c.data, coletado_em:c.coletado_em, fontes:c.fontes})"`). O arquivo é grande: nunca o leia inteiro.
2. Se `relatorios/leis/ultimo.json` já existir com o mesmo `data` **e** o mesmo `coletado_em`, **pare**: a análise dessa coleta já foi feita. (Mesmo `data` com `coletado_em` diferente = o dia foi coletado de novo, por exemplo porque Lajeado publicou mais tarde: faça a análise inteira de novo.)
3. Se a data da coleta for mais antiga que ontem (horário de Brasília), pare também: a coleta não rodou.

## Passo 2: triagem

Leia `relatorios/leis/textos/triagem.txt` (uma linha por ato: id | tipo | órgão | título | começo do texto). Ela traz só os atos normativos. Atos de pessoal, contratos e licitações (Seções 2 e 3 do DOU e boa parte do DOE-RS) também estão na coleta, marcados com `"lista": true`, mas só aparecem na lista do site: **nunca** são destaque.

Marque como **candidato a destaque** todo ato que **cria, muda ou revoga regras** que valem para pessoas, empresas, profissionais, contribuintes, servidores em geral ou para o funcionamento de serviços públicos. Exemplos: leis, medidas provisórias, decretos regulamentares, instruções normativas, resoluções de agências e conselhos, portarias que mudam procedimentos, atos que mudam impostos, preços públicos, benefícios ou prazos.

**Não** são destaque (só entram na contagem): nomeações, comissões, pautas, atas, despachos e decisões sobre um caso individual (uma empresa, um servidor, um processo), autos de infração e notificações individuais, licenças e registros individuais, contratos, convênios, repasses pontuais a um município, retificações de erro de digitação.

**Lajeado:** todos os atos da prefeitura entram como destaque, mesmo os simples (créditos suplementares podem ser descritos numa frase).

## Passo 3: ler na íntegra

Para cada candidato, leia o texto completo:

```
node scripts/leis-texto.mjs <id> [<id> ...]
```

Leia em lotes de até 10 ids. Se o texto for longo, concentre-se na ementa, nos artigos que criam obrigações ou direitos, nas datas de vigência e nas revogações.

## Passo 4: escrever `relatorios/leis/ultimo.json`

```json
{
  "data": "AAAA-MM-DD (o mesmo da coleta)",
  "gerado_em": "data e hora ISO",
  "resumo": {
    "federal": "2 a 4 frases sobre o que de mais importante saiu no Diário Oficial da União.",
    "estadual": "2 a 4 frases sobre o Rio Grande do Sul.",
    "municipal": "1 a 3 frases sobre Lajeado (ou: 'Não houve publicação em Lajeado neste dia.')"
  },
  "destaques": [
    {
      "id": "id exato da triagem (ex.: dou-740643110, rs-1498861, laj-2677-2)",
      "relevancia": "alta | media",
      "area": "fazenda | saude | outros",
      "temas": ["saúde", "tributos"],
      "o_que_muda": "1 a 3 frases simples. Diga a regra nova, não repita a ementa.",
      "quem_afeta": "quem precisa prestar atenção (ex.: médicos, empresas do Simples, motoristas de Lajeado).",
      "vigencia": "quando passa a valer (ex.: na publicação; em 90 dias; 1º/01/2027). Vazio se o texto não disser.",
      "imposto": {
        "tributo": "só quando a norma muda o valor de um imposto, taxa ou contribuição (ex.: ICMS sobre a gasolina)",
        "antes": "(exemplo) R$ 1,00 por litro",
        "depois": "(exemplo) R$ 1,10 por litro",
        "variacao_pct": 10.0,
        "obs": "de onde veio o valor anterior (norma e site consultado) e qualquer ressalva"
      }
    }
  ],
  "demais": {
    "federal": "1 ou 2 frases sobre o que mais saiu e não virou destaque (ex.: 40 portarias de pessoal, 12 decisões individuais da ANVISA).",
    "estadual": "idem para o RS",
    "municipal": "idem para Lajeado, se houver"
  }
}
```

Regras:

- `area`: `fazenda` para impostos, taxas, orçamento, dívida, finanças públicas e regras do sistema financeiro; `saude` para saúde, SUS, medicamentos, vigilância sanitária e profissões da saúde; `outros` para o resto. O site e o e-mail filtram os destaques por ela.
- Use **só ids que existem** na triagem. Título, órgão e link são preenchidos depois pelo programa a partir do id: não os escreva.
- **Relevância alta**: lei, MP, decreto ou norma que afeta muita gente ou o bolso (impostos, salário, benefícios, saúde, trânsito), e qualquer coisa que afete médicos ou serviços de saúde. O resto é média.
- Ordene: primeiro alta, depois média; dentro disso, federal, estadual, municipal.
- Escreva em português do Brasil, frases curtas, sem juridiquês. Não dê opinião política nem conselho jurídico: descreva o que a norma diz.
- Se uma fonte falhou (veja `fontes` na coleta), diga isso no `resumo` daquela esfera.
- Num dia sem destaques, deixe `destaques` vazio e explique no `resumo`.

### Impostos: sempre "antes → depois → %"

Quando um destaque **muda o valor** de um imposto, taxa, contribuição ou tarifa pública (alíquota, valor fixo, base de cálculo, isenção que acaba ou começa), inclua o campo `imposto`:

- `depois`: o valor novo, como está no texto.
- `antes`: o valor que valia até agora. Procure primeiro no próprio texto (às vezes ele diz "de X para Y"). Se não estiver lá, **pesquise na internet** (WebSearch / WebFetch) em fontes oficiais ou jornalísticas, e diga a fonte em `obs`. Se as fontes divergirem ou você não tiver certeza, escreva o valor mais provável seguido de "(não confirmado)" e explique em `obs`. **Nunca invente.** Se não achar, use `"antes": "não encontrado"` e deixe `variacao_pct` de fora.
- `variacao_pct`: (depois ÷ antes − 1) × 100, com 1 casa decimal (número, positivo se aumentou, negativo se diminuiu). Para alíquotas em %, é a variação da própria alíquota (ex.: de 17% para 19% = +11,8%); diga também os pontos percentuais em `obs`.
- Em `o_que_muda`, diga em palavras se o imposto **aumentou ou diminuiu** e para quem.
- Normas que só mudam prazos ou procedimentos de um imposto (sem mudar o valor) não levam o campo `imposto`.

## Passo 5: validar e publicar

```
node scripts/leis-validar.mjs
```

O programa confere os ids, completa título/órgão/link e grava também `relatorios/leis/historico/<data>.json`. Se apontar erro, corrija o JSON e rode de novo. Depois:

```
git add relatorios/leis/ultimo.json relatorios/leis/historico/
git commit -m "Radar de leis <data>"
git pull --rebase && git push
```

O push dispara o envio do e-mail.
