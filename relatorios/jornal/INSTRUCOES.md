# Jornal Kotidi: instruções da edição diária

Você vai escrever a edição de **hoje** do jornal www.kotidi.com.br, para leitores brasileiros leigos. O sistema do Kotidi lê o arquivo que você publicar e põe a edição no ar às **7h (Brasília)**; se o arquivo chegar depois, as matérias entram assim que chegarem.

**Prazo:** o arquivo precisa estar publicado até as **6h (Brasília)**. Se o tempo apertar, publique o que estiver pronto e conferido (veja "Publicar em duas partes").

## Passo 1: pauta, data e o que já saiu

0. Leia a **pauta do administrador**, em https://api.kotidi.com.br/journal/pauta (WebFetch ou `curl`). Ela diz o que o jornal publica e pode ter mudado: **vale a pauta**, e estas instruções dizem como fazer. As regras do Passo 2, o formato do Passo 4 e as regras de imagem continuam valendo em qualquer caso. Se o endereço não abrir, siga só estas instruções e avise na resposta final.
1. `git pull`. A data da edição é a de hoje no fuso de São Paulo: `TZ=America/Sao_Paulo date +%F`.
2. Se `relatorios/jornal/edicoes/<hoje>.json` já existir e estiver completo (todas as seções do Passo 3), pare e diga isso na resposta final.
3. Leia os títulos das edições anteriores para **não repetir** filme, série, destino turístico, estudo ou notícia: `node scripts/jornal-anteriores.mjs`.

## Passo 2: regras de texto (valem para todas as matérias)

- Português do Brasil, frases curtas, sem juridiquês nem jargão. Explique termos técnicos.
- **Nada inventado.** Todo fato, número, data e citação precisa estar numa página que você (ou o subagente) **abriu** com WebFetch. Título de resultado de busca não basta. Se não conseguir confirmar, não publique.
- Escreva com suas palavras. Não copie trechos das fontes (no máximo uma citação curta, com o nome de quem disse).
- Sem opinião política própria, sem sensacionalismo. Não atribua a uma pessoa nomeada acusações ou xingamentos; processos e investigações só com o que a fonte oficial ou a imprensa confirmam, deixando claro que é investigação.
- Saúde de pessoas ou animais: diga o tipo de estudo e seus limites, não indique remédio nem dose, e oriente a conversar com o médico ou o veterinário.
- Não publique dados pessoais de pessoas comuns: quem não é figura pública não é citado pelo nome nem pela idade (ex.: participantes de um programa, pacientes).
- Não publique o mesmo acontecimento em duas matérias ou seções.
- Texto simples com parágrafos, `## subtítulo`, listas com `- ` e links `[nome](https://...)`. Nada de HTML, negrito, tabelas ou imagens no texto. Não escreva uma seção "Fontes": ela é montada a partir do campo `fontes`.

## Passo 3: as seções

Em Esportes, Mundo e Governo, **procure uma foto real para cada matéria**; só deixe sem imagem quando não houver foto adequada.

Faça os subagentes (ferramenta Agent) em paralelo, um por grupo abaixo, passando a cada um as regras do Passo 2, a data, a lista do que não repetir e o formato do Passo 4. Cada um grava um arquivo `/tmp/jornal/<grupo>.json` com a lista das suas matérias. Dê a eles até as 5h30.

| Seção (`secao`) | O que publicar | Imagem |
|---|---|---|
| `longevidade` (Saúde) | A busca diária de longevidade no PubMed (abaixo), transformada em texto para leigos: até 6 estudos, os mais úteis para o público; deixe de fora os fora do assunto. | `ia`, uma por matéria |
| `longevidade` (Saúde) | Notícia de **governo ligada à saúde** (SUS, Anvisa, vacinas, remédios, planos de saúde, Ministério da Saúde) publicada ontem ou hoje: até 3. | `ia` |
| `pets` | Meta-análises novas sobre animais de estimação (qualquer um) no PubMed, uma matéria por estudo, até 3. Se não houver meta-análise nova, uma **revisão sistemática**. | `ia` |
| `filmes` | 8 indicações: 2 de cada serviço (Prime Video, Netflix, Disney+, Globoplay), variando os gêneros e os dias. Cada indicação é uma matéria **só com título e texto** (onde assistir, gênero, filme ou série, ano e por que vale a pena), até 2.200 caracteres. Confira que o título está no catálogo brasileiro. | nenhuma |
| `esportes` | Notícias dos **4 primeiros e dos 4 últimos** colocados do Campeonato Brasileiro (fora da temporada, o que aconteceu com esses clubes) e **uma notícia de cada outro esporte** em destaque no dia. | `foto` ou nenhuma |
| `esportes` | **Mercado da bola**: uma matéria por movimentação (contratação, venda, saída, renovação, troca de técnico) das últimas 24 horas, com a fonte. O que não foi confirmado começa o título com "Rumor:". | `foto` ou nenhuma |
| `turismo` | Um destino do mundo, com o que fazer, quando ir e um cuidado prático. | `foto` obrigatória (nunca IA) |
| `moda` | **Duas** matérias sobre como se vestir hoje: uma para mulheres e outra para homens, levando em conta a estação no Brasil. | `ia`, uma por matéria |
| `guerras` (Mundo) | Uma matéria **fixada** (`"fixada": true`) "Guerras em andamento no mundo", por região, com **todas** as guerras em curso e a **data de início** de cada uma (confira se alguma começou ou acabou). | `foto` ou nenhuma |
| `guerras` (Mundo) | As novidades do dia: 2 a 4 matérias. | `foto` ou nenhuma |
| `presidente` (Governo) | Uma matéria do dia sobre o presidente do Brasil em exercício (confirme quem é), em assunto **que não seja saúde**. **Tudo o que for de saúde vai para `longevidade`** (Saúde), mesmo envolvendo o presidente ou o governo. | `foto` ou nenhuma |

**Leis e atos do Diário Oficial não entram aqui**: o sistema já os traz do Radar de leis. **Investimentos também não** (vem do relatório do mercado).

### Busca diária de longevidade (PubMed)

Use a API do PubMed (E-utilities) com a data de entrada de ontem; se vierem menos de 3 estudos úteis, olhe os últimos 3 dias:

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=40&datetype=edat&reldate=1&term=<TERMO codificado>
```

TERMO:

```
(("Longevity"[tiab]) AND ("Clinical Trial"[pt] OR "Review"[pt] OR systematic[sb] OR "Randomized Controlled Trial"[pt] OR "Meta-Analysis"[pt]) AND (humans[mh] OR (all[sb] NOT medline[sb]))) NOT ("insufficiency"[tiab] OR "crisis"[tiab] OR "Endodontics"[tiab] OR "Inflammatory Bowel Disease"[tiab] OR "IBD"[tiab] OR "Surgeon"[tiab] OR "HIV"[tiab] OR "Human Immunodeficiency Virus"[tiab] OR "Dentin"[tiab] OR "Frailty"[tiab] OR "Implant"[tiab] OR "Nanobubble"[tiab] OR "Prostatectomy"[tiab] OR "Inlay"[tiab] OR "elite"[tiab] OR "Wastewater"[tiab] OR "Meniscus"[tiab] OR "Resin"[tiab])
```

Resumos: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&rettype=abstract&retmode=text&id=<ids>`. A fonte de cada matéria é `https://pubmed.ncbi.nlm.nih.gov/<id>/`.

Pets: mesmo serviço, com termos como `(dogs[tiab] OR dog[tiab] OR canine[tiab] OR cats[tiab] OR cat[tiab] OR feline[tiab] OR "companion animals"[tiab] OR pet[tiab] OR horses[tiab] OR rabbits[tiab] OR birds[tiab]) AND "Meta-Analysis"[pt]` (e `systematic[sb]` se não houver), olhando os últimos dias até achar um que ainda não saiu.

## Passo 4: o arquivo da edição

`relatorios/jornal/edicoes/AAAA-MM-DD.json`:

```json
{
  "data": "AAAA-MM-DD",
  "gerado_em": "data e hora ISO",
  "materias": [
    {
      "id": "saude-1",
      "secao": "longevidade",
      "titulo": "até 200 caracteres, claro, dizendo o que há de novo",
      "resumo": "uma ou duas frases, até 400 caracteres",
      "texto": "o texto da matéria",
      "fixada": false,
      "imagem": { "tipo": "ia", "cena": "descrição de uma FOTOGRAFIA realista que conte a notícia" },
      "fontes": [{ "nome": "nome do veículo ou revista", "url": "https://...", "data": "AAAA-MM-DD" }]
    }
  ]
}
```

- `id`: único na edição, só letras minúsculas, números e hífen (ex.: `saude-1`, `pets-1`, `filme-netflix-2`, `bola-3`, `guerras-lista`). **Não mude o id de uma matéria já publicada.**
- **Filmes**: só `id`, `secao`, `titulo` e `texto`; sem `resumo`, `imagem` e `fontes`.
- Todas as outras precisam de `resumo` e de ao menos uma fonte.

### Imagens: sempre realistas

- `"tipo": "ia"` (só em Saúde, Pets e Moda): em `cena`, descreva uma **fotografia** possível de acontecer, como a de um fotojornalista: quem aparece (pessoas brasileiras e diversas, ou o animal), fazendo o quê, onde, com que luz. A cena sozinha deve contar o assunto. Nunca peça desenho, ilustração, 3D, montagem, setas, textos, gráficos, logotipos ou pessoas famosas.
- `"tipo": "foto"` (Esportes, Turismo, Mundo, Governo): fotografia real do **Wikimedia Commons** com licença livre:
  `{ "tipo": "foto", "url": "https://upload.wikimedia.org/...", "legenda": "o que a foto mostra, com o ano se for de arquivo", "credito": "Autor / Wikimedia Commons (licença)" }`.
  Ache pela API: `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=<termo>&gsrlimit=8&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1600` e use o campo `thumburl`. A legenda não pode dar a entender que uma foto antiga é de hoje. Sem foto adequada, não ponha imagem.

## Passo 5: validar e publicar

```
node scripts/jornal-montar.mjs /tmp/jornal      # junta os arquivos dos grupos na edição de hoje
node scripts/jornal-validar.mjs                 # confere o formato (aponta o que corrigir)
git add relatorios/jornal/
git commit -m "Jornal AAAA-MM-DD"
git pull --rebase && git push origin HEAD:main
```

**Publicar em duas partes:** se às 5h30 ainda faltar algum grupo, monte, valide e publique o que está pronto; quando o resto ficar pronto, rode de novo os mesmos comandos (o montador mantém o que já estava e acrescenta o novo).

Resposta final: data, nº de matérias por seção, seções que faltaram, páginas abertas, se o push deu certo e qualquer problema.
