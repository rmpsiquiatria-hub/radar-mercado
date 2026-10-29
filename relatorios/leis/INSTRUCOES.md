# Radar de leis: instruções da análise diária

Você vai analisar as normas publicadas num dia no **Diário Oficial da União (Seção 1)**, no **Diário Oficial do Rio Grande do Sul** e no **Diário Oficial de Lajeado (RS)**. Elas já foram baixadas por um programa (`scripts/leis-coleta.mjs`). **Não use a internet**: tudo o que você precisa está no repositório.

O leitor é uma pessoa leiga em Direito, que mora em Lajeado (RS). Ele quer saber, em linguagem simples, **o que mudou nas regras** e se isso o afeta. A abrangência é total e todos os temas interessam (saúde, tributos, trabalho, trânsito, educação, meio ambiente, economia, previdência, consumidor, servidores…).

## Passo 1: conferir se há trabalho a fazer

1. Leia `relatorios/leis/coleta.json` só até o campo `itens` (use `node -p "const c=require('./relatorios/leis/coleta.json'); JSON.stringify({data:c.data, fontes:c.fontes})"`).
2. Se `relatorios/leis/ultimo.json` já existir com o mesmo `data`, **pare**: a análise do dia já foi feita.
3. Se a data da coleta for mais antiga que ontem (horário de Brasília), pare também: a coleta não rodou.

## Passo 2: triagem

Leia `relatorios/leis/textos/triagem.txt` (uma linha por ato: id | tipo | órgão | título | começo do texto).

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
  "resumo_geral": "3 a 5 frases: o que de mais importante saiu no dia, nas três esferas.",
  "destaques": [
    {
      "id": "id exato da triagem (ex.: dou-740643110, rs-1498861, laj-2677-2)",
      "relevancia": "alta | media",
      "temas": ["saúde", "tributos"],
      "o_que_muda": "1 a 3 frases simples. Diga a regra nova, não repita a ementa.",
      "quem_afeta": "quem precisa prestar atenção (ex.: médicos, empresas do Simples, motoristas de Lajeado).",
      "vigencia": "quando passa a valer (ex.: na publicação; em 90 dias; 1º/01/2027). Vazio se o texto não disser."
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

- Use **só ids que existem** na triagem. Título, órgão e link são preenchidos depois pelo programa a partir do id: não os escreva.
- **Relevância alta**: lei, MP, decreto ou norma que afeta muita gente ou o bolso (impostos, salário, benefícios, saúde, trânsito), e qualquer coisa que afete médicos ou serviços de saúde. O resto é média.
- Ordene: primeiro alta, depois média; dentro disso, federal, estadual, municipal.
- Escreva em português do Brasil, frases curtas, sem juridiquês. Não dê opinião política nem conselho jurídico: descreva o que a norma diz.
- Se uma fonte falhou (veja `fontes` na coleta), diga isso no `resumo_geral`.
- Num dia sem destaques, deixe `destaques` vazio e explique no `resumo_geral`.

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
