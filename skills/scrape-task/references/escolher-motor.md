# Escolher motor e operação

Dois motores, ambos instalados no projeto (use `npx`, não instale nada global):

- **`just-scrape`** (skill `just-scrape`, ScrapeGraph AI): rápido, entende a página com IA, renderiza JS. Gasta créditos. Precisa de `$SGAI_API_KEY`.
- **`browser`** (skill `browser`, CLI `browse`): navegador real no computador do usuário. Grátis, mais lento, faz o que um humano faria (clicar, rolar, preencher, paginar).

Antes do primeiro job da sessão: `npx just-scrape validate --json` e `npx just-scrape credits --json`. Se a chave faltar, diga ao usuário para preencher `SGAI_API_KEY` no `.env` e ofereça o motor `browser` enquanto isso.

## Tabela de decisão

| O pedido | engine | operation | shape | Comando base |
|---|---|---|---|---|
| Sem URL ("lojas que vendem X", "notícias sobre Y") | just-scrape | search | table | `npx just-scrape search "<busca>" --num-results 10 -p "<prompt>" --schema '<schema>' --json` |
| URL + campos ("preços", "lista de vagas") | just-scrape | extract | table | `npx just-scrape extract "<url>" -p "<prompt>" --schema '<schema>' --json` |
| URL + "o texto", "o conteúdo", "em Markdown" | just-scrape | scrape | documents | `npx just-scrape scrape "<url>" -f markdown --json` |
| Várias páginas de uma seção ("toda a doc", "todos os posts") | just-scrape | crawl | documents | `npx just-scrape crawl "<url>" -f markdown --max-pages 20 --max-depth 2 --include-patterns '["^<url>.*"]' --json` |
| Campos de muitas páginas de uma seção | just-scrape | crawl | table | crawl como acima, depois `extract` só nas URLs que interessam (até 10, 3 por vez) |
| "Avise quando mudar", "acompanhe todo dia" | just-scrape | monitor | documents | `npx just-scrape monitor create --url "<url>" --interval 1d --name "<id>" -f markdown --json` (pede confirmação; grave o `cronId` em `result.monitor`) |
| Precisa clicar, abrir abas, "carregar mais", paginação por botão | browser | browse | table ou documents | `npx browse open "<url>" --local`, depois `snapshot` / `click` / `get markdown` |
| Página que só aparece logado na conta do usuário | browser | browse | table ou documents | `npx browse open "<url>" --auto-connect` (pede confirmação; usa o Chrome dele já aberto) |

Padrões que entram em `options` e `assumptions` quando o usuário não disse nada:

- `mode: "js"` só se a primeira tentativa vier vazia; `scrolls: 3` para listas com rolagem infinita.
- Crawl: `maxPages: 20`, `maxDepth: 2`, preso ao caminho da URL inicial.
- Search: `numResults: 10`.
- Monitor: `interval: "1d"`.

## Quando falha

Suba um degrau por vez, no máximo 3 tentativas no total:

1. **Vazio ou incompleto** → repita com `--mode js` e, se for lista, `--scrolls 5`.
2. **Ainda vazio, ou os dados dependem de clique/paginação** → mude para `browser` com `--local`: `open`, `snapshot`, interaja, `get markdown` ou `get text`, e extraia os campos você mesmo do texto.
3. **Bloqueio** (403, 429, CAPTCHA, "checking your browser", página de login inesperada) → pare. `status: blocked`, `error` com o que apareceu. Não tente contornar.
4. **Extração solta** (campos trocados, misturados) → aperte o `--schema` (tipos, `required`, `description` em cada campo) e rode de novo.

Erro de crédito ou de chave não é falha do site: grave `status: failed`, explique e não troque de motor sem avisar.

## Paginação

- Links numerados ou `?page=N` na URL: monte as URLs e faça `extract` em cada uma (até 10 sem perguntar), juntando as linhas.
- Botão "próxima" ou "carregar mais" sem URL própria: `browser`, clicando até acabar ou até 10 páginas.
- Registre em `assumptions` quantas páginas foram e como pedir mais.

## Usando o browser

```bash
npx browse open "<url>" --local
npx browse snapshot                 # árvore de acessibilidade com refs (@0-5)
npx browse click @0-5               # clique pelo ref do snapshot
npx browse get markdown main        # conteúdo como Markdown
npx browse get text "table"         # texto de um seletor
npx browse stop                     # sempre no fim
```

Salve cada `get` em `data/jobs/<id>/raw/browse-<n>.md` antes de extrair. Prefira `snapshot` a `screenshot`.
