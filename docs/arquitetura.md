# Como funciona por dentro

## Peças

```
web/ (React + Vite)                 src/server/ (node:http)                        .claude/skills/
┌──────────────────────┐   HTTP    ┌───────────────────────────────┐   Agent SDK   ┌──────────────────────┐
│ conversa + atalhos   │ ────────► │ app.ts      rotas /api        │ ────────────► │ scrape-task (local)  │
│ painel do job        │ ◄──────── │ chats.ts    turnos + eventos  │               │ just-scrape          │
│ histórico, monitores │    SSE    │ policy.ts   o que o agente    │ ◄──────────── │ browser              │
└──────────────────────┘           │             pode fazer        │  mensagens    └──────────┬───────────┘
                                   │ monitors.ts SDK da ScrapeGraph│                          │ grava
                                   └──────────────┬────────────────┘                          ▼
                                                  │ lê                              data/jobs/<id>/
                                                  └───────────────────────────────► job.json · raw/ · result.json
```

- **Skills** (`skills.json`, instaladas por `npm run setup` em `.claude/skills/`). As de *runtime* são as que o agente do chat recebe: `scrape-task` (local, em `skills/`), `just-scrape` e `browser`. As de *dev* (`find-skills`, `frontend-design`) servem só para construir o projeto.
- **`scrape-task`** é a porta de entrada de todo pedido: cria o job, escolhe o motor ([escolher-motor.md](../skills/scrape-task/references/escolher-motor.md)), grava o plano, roda, normaliza e confere com `npm run job -- check`.
- **Servidor** (`src/server/`): cada mensagem vira um turno do Claude Agent SDK (`agent.ts`), que continua a sessão anterior da mesma conversa (`resume`). O que acontece no turno vira eventos (`events.ts`) que vão para a tela por SSE e ficam salvos em `data/chats/<id>.json`.
- **Interface** (`web/`): importa só tipos do servidor. `thread.ts` monta a conversa a partir dos eventos; `table.ts` filtra, ordena, exporta e converte schema em campos; `shortcuts.ts` guarda os atalhos.

## Um pedido, do começo ao fim

1. Você clica em **Extrair a lista** com um link no campo. A interface monta o texto (`compose` em `shortcuts.ts`) e faz `POST /api/chats/:id/messages`.
2. O servidor começa o turno e responde 202. A tela já está ouvindo `GET /api/chats/:id/stream`.
3. O agente usa a skill `scrape-task`: `npm run job -- new` cria `data/jobs/<id>/`, ele grava `job.json` e roda `npx just-scrape extract ... --json > data/jobs/<id>/raw/extract-1.json`.
4. Cada chamada de ferramenta passa pela política (`policy.ts`). Se pedir aprovação, a tela recebe um evento `approval` e o turno espera o seu clique (até 10 minutos; depois disso, vale "não").
5. O agente normaliza os dados em `result.json` e roda `npm run job -- check` até passar.
6. O servidor percebe o id do job nas ferramentas, lê a pasta e manda um evento `job`. A tela abre a tabela.
7. O turno acaba com `done`, com o custo e a duração.

## Eventos (SSE)

| Evento | Quando |
|---|---|
| `user` | Sua mensagem |
| `session` | O agente começou (modelo em uso) |
| `text-delta` | Pedaço de texto ao vivo (não fica salvo) |
| `text` | Texto final de um bloco da resposta |
| `tool` / `tool-result` | Uma ferramenta começou / terminou |
| `approval` / `approval-resolved` | Pedido de aprovação e a sua resposta |
| `job` | Um job foi criado ou mudou (resumo com situação e número de itens) |
| `done` | Fim do turno: `ok`, custo, duração e o erro, se houve |

Cada evento salvo tem um número (`seq`). A tela reconecta com `?after=<seq>` e recebe só o que perdeu.

## Contrato dos jobs

A pasta `data/jobs/<id>/` é a única coisa que o servidor e a interface leem de um job. O formato está em [contrato-dos-jobs.md](../skills/scrape-task/references/contrato-dos-jobs.md) e as regras em `src/jobs/contract.ts` (validadas com ajv). Os exemplos do documento são usados pelos testes, então documento e código não se separam.

## O que o agente pode fazer

`src/server/policy.ts` decide cada chamada de ferramenta. É uma função pura, com testes linha a linha em `test/policy.test.ts`.

| | |
|---|---|
| **Sem perguntar** | `npx just-scrape` (search, scrape, extract, crawl até 50 páginas, monitor list/get/activity), `npx browse --local`, `npm run job`, leitura de arquivos do projeto, `jq`/`head`/`grep` e afins, gravar em `data/jobs/` |
| **Pede aprovação** | criar, mudar, retomar ou apagar monitor; crawl sem `--max-pages` ou acima de 50; `browse --auto-connect` (o seu Chrome logado) |
| **Nunca** | `--stealth`, `browse --remote` / `--cdp`, instalar pacotes, ler `.env`, gravar fora de `data/jobs/`, redirecionar saída para fora do projeto, substituição de comando, qualquer outro programa |

Além disso, o servidor tira `BROWSERBASE_API_KEY` do ambiente do agente, para o `browse` nunca ir para a nuvem por conta própria.

## API

| Rota | O que faz |
|---|---|
| `GET /api/health` | Modelo, esforço, agente de teste ou não, quais chaves estão no `.env` |
| `GET/POST /api/chats` | Lista / cria conversas |
| `GET /api/chats/:id` | Conversa com todos os eventos |
| `POST /api/chats/:id/messages` | `{ "text": "..." }`: começa um turno (202; 409 se já houver um rodando) |
| `GET /api/chats/:id/stream?after=N` | Eventos depois de N e os novos ao vivo |
| `POST /api/chats/:id/approvals/:aid` | `{ "allow": true }` |
| `POST /api/chats/:id/stop` | Interrompe o turno |
| `GET /api/jobs`, `GET /api/jobs/:id` | Histórico (com a conversa de origem) e um job com `job.json`, `result.json` e problemas do contrato |
| `GET/POST /api/shortcuts`, `DELETE /api/shortcuts/:id` | Atalhos salvos (`data/shortcuts.json`) |
| `GET /api/monitors`, `GET /api/monitors/:id/activity` | Monitores da ScrapeGraph (com o job que criou cada um) e as últimas execuções |
| `POST /api/monitors/:id/pause`, `.../resume`, `DELETE /api/monitors/:id` | Ações nos monitores, direto pelo SDK `scrapegraph-js` |

## Configuração

| Variável | Padrão | Para quê |
|---|---|---|
| `SGAI_API_KEY` | | Motor ScrapeGraph e tela de Monitores |
| `ANTHROPIC_API_KEY` | login do Claude Code | Agente do chat |
| `SCRAPE_CHAT_PORT` | `8787` | Porta do servidor |
| `SCRAPE_CHAT_MODEL` | `claude-opus-5-5` | Modelo do agente |
| `SCRAPE_CHAT_EFFORT` | `high` | Esforço do agente (`low` a `max`) |
| `SCRAPE_CHAT_MAX_USD` | `2` | Teto de gasto do agente por mensagem |
| `SCRAPE_CHAT_MAX_TURNS` | `80` | Teto de passos por mensagem |
| `SCRAPE_CHAT_FAKE_AGENT` | | `1` liga o agente e os monitores de teste |
| `SCRAPE_CHAT_DATA_ROOT` | a pasta do projeto | Onde fica `data/`, só com o agente de teste (usado pelo `npm run e2e`) |
