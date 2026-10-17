# Contrato dos jobs

Cada pedido de scraping vira uma pasta `data/jobs/<id>/`. O servidor e a interface leem só esta pasta, então ela precisa se explicar sozinha. Os tipos e as regras de verdade estão em `src/jobs/contract.ts`; `npm run job -- check <id>` confere tudo.

```
data/jobs/2026-10-17-1530-precos-notebooks/
├── job.json      o plano (gravado antes de rodar)
├── raw/          saída bruta do motor (just-scrape --json, browse get ...)
└── result.json   os dados normalizados (gravado no fim)
```

O id é `AAAA-MM-DD-HHMM-apelido`. Crie com `npm run --silent job -- new "<apelido>"`.

## job.json

```json
{
  "version": 1,
  "id": "2026-10-17-1530-precos-notebooks",
  "createdAt": "2026-10-17T15:30:00-03:00",
  "request": "quero os preços dos notebooks dessa página https://loja.example/notebooks",
  "goal": "Nome, preço e link de cada notebook da primeira página da categoria",
  "engine": "just-scrape",
  "operation": "extract",
  "targets": ["https://loja.example/notebooks"],
  "prompt": "Extraia cada notebook listado: nome, preço em reais (número) e link do produto",
  "schema": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "nome": { "type": "string" },
            "preco": { "type": ["number", "null"], "description": "em reais, sem R$" },
            "url": { "type": "string" }
          },
          "required": ["nome", "preco", "url"]
        }
      }
    },
    "required": ["items"]
  },
  "shape": "table",
  "options": {},
  "assumptions": ["só a primeira página; peça 'todas as páginas' para seguir a paginação"]
}
```

| Campo | Regra |
|---|---|
| `engine` / `operation` | `just-scrape`: search, scrape, extract, crawl, monitor. `browser`: só browse. |
| `targets` | URLs http(s); para `search`, a frase de busca. |
| `schema` | JSON Schema. Para `shape: table`, as linhas ficam em `properties.items` (array). Pode ser `null` para documentos. |
| `shape` | `table` (linhas e colunas) ou `documents` (páginas em Markdown). |
| `assumptions` | Tudo o que você decidiu sem perguntar. A interface mostra isso para o usuário corrigir com um clique. |

## result.json

```json
{
  "version": 1,
  "jobId": "2026-10-17-1530-precos-notebooks",
  "status": "done",
  "finishedAt": "2026-10-17T15:31:12-03:00",
  "commands": [
    "npx just-scrape extract \"https://loja.example/notebooks\" -p \"...\" --schema '...' --json > data/jobs/2026-10-17-1530-precos-notebooks/raw/extract-1.json"
  ],
  "columns": ["nome", "preco", "url"],
  "rows": [
    { "nome": "Notebook A 14\"", "preco": 3299.9, "url": "https://loja.example/p/a" }
  ],
  "sources": ["https://loja.example/notebooks"],
  "warnings": [],
  "error": null
}
```

| `status` | Quando |
|---|---|
| `done` | Entregou o que o job pediu (tabela com pelo menos uma linha, ou pelo menos um documento). |
| `partial` | Entregou parte (algumas páginas falharam, limite atingido). Explique em `warnings`. |
| `blocked` | O site bloqueou (403, 429, CAPTCHA). `error` obrigatório. |
| `failed` | Erro do motor, da chave ou dos créditos. `error` obrigatório. |

Num job `monitor`, grave também o monitor criado (o `cronId` que `just-scrape monitor create --json` devolve), para a tela de Monitores ligar o monitor ao job:

```text
"monitor": { "id": "<cronId>", "url": "https://loja.example/promocoes", "interval": "1d" }
```

Regras conferidas pelo `job -- check`:

1. `jobId` igual ao `id` do job e ao nome da pasta.
2. Tabela: `columns` lista todos os campos que aparecem em `rows`, e cada linha passa no schema de `items` do job.
3. Documentos: `documents` com `url` e `markdown` em cada um.
4. Nenhum segredo escrito em `commands` (chaves `sgai-...`, `Bearer ...`): use `$VARIAVEL`.
5. `blocked` e `failed` explicam o motivo em `error`.
6. Job `monitor` que deu certo tem `monitor` com `id`, `url` e `interval`.
