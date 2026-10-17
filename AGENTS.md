# Instruções para agentes

Este repositório é o **scrape-chat**: um web scraper com IA numa interface de chat. O usuário descreve o que quer extrair (ou clica num atalho) e o agente escolhe a skill certa, roda o scraping e devolve os dados como artefatos (tabela, JSON, CSV).

## Pedidos de scraping

Todo pedido de extrair, raspar, buscar ou monitorar dados de sites passa pela skill local **`scrape-task`**: ela cria o job em `data/jobs/<id>/`, escolhe o motor e grava `result.json`. Não chame `just-scrape` ou `browser` direto sem um job.

## Servidor

`src/server/` roda o agente do chat com o Claude Agent SDK. O que ele pode fazer está em `src/server/policy.ts` (permitido, pede aprovação, negado). Ao liberar um comando novo para o agente, mude a política **e** o `test/policy.test.ts`.

## Monitores

`src/server/monitors.ts` fala com a ScrapeGraph pelo SDK `scrapegraph-js` (listar, ver execuções, pausar, retomar, apagar). São cliques do usuário, então não passam pela política do agente. Criar monitor continua sendo trabalho do agente (com aprovação), que grava o `cronId` em `result.monitor`. No modo `--fake`, `createFakeMonitors()` substitui a ScrapeGraph.

## Interface

`web/` é React + Vite e importa só **tipos** do servidor (`src/server/events.ts`, `src/jobs/store.ts`). A conversa é montada por `web/src/thread.ts` a partir dos eventos SSE: mude ali (e em `test/thread.test.ts`) quando surgir um evento novo. Respostas do agente passam por `web/src/Markdown.tsx`, que nunca gera HTML cru. Os atalhos (textos prontos e próximos passos de um job) ficam em `web/src/shortcuts.ts`, testados em `test/shortcuts.test.ts`. Filtrar, ordenar, exportar e converter schema ⇄ campos ficam em `web/src/table.ts` (testado em `test/table.test.ts`). Para testar sem gastar: `npm run dev -- --fake` (o agente de teste tem um caso de tabela e um de páginas, se a mensagem falar em Markdown).

## Skills

A lista fica em `skills.json`; `npm run setup` instala tudo. Cada skill externa tem um `role`:

- **runtime** (o agente do chat usa ao fazer scraping)
  - `just-scrape`: motor principal (ScrapeGraph AI). search, scrape, extract com schema, crawl e monitor. Precisa de `SGAI_API_KEY` e gasta créditos.
  - `browser`: plano B com navegador real, para sites que precisam de cliques, rolagem, paginação ou o login do próprio usuário.
- **dev** (só para construir o projeto)
  - `find-skills`: procurar skills novas no skills.sh antes de escrever uma do zero.
  - `frontend-design`: usar ao criar ou mudar a interface de chat e os artefatos.

## Regras do repositório

- Ao mudar `skills/` ou `skills.json`: rode `npm run setup` (as skills locais são **copiadas** para `.claude/skills/`) e depois `npm run validate`.
- Os CLIs `just-scrape` e `browse` estão fixados no `package.json`: rode com `npx`, nunca `npm install -g` (as skills externas sugerem isso; ignore).
- Ao mudar `src/jobs/contract.ts`, atualize os exemplos em `skills/scrape-task/references/contrato-dos-jobs.md` (os testes usam esses exemplos).
- Antes de concluir mudanças: `npm run check` (typecheck + testes + validate) e, se mexeu no servidor ou na interface, `npm run e2e` (fluxo inteiro com o agente de teste, sem gastar). `npm run e2e:real -- --gastar` usa o agente de verdade e só roda quando o dono pedir.
- Como tudo se encaixa: `docs/arquitetura.md`. Problemas comuns: `docs/solucao-de-problemas.md`.
- Scripts em TypeScript executado direto pelo Node (≥ 22.18): imports com extensão `.ts`, sem `enum` nem `namespace` (`erasableSyntaxOnly`).
- Chaves de API ficam em `.env` (modelo em `.env.example`), nunca no código nem nos logs.
- Scraping responsável: respeite `robots.txt` e os termos do site, não contorne CAPTCHA ou bloqueio anti-bot, e só use login com a sessão do próprio usuário.
- Não faça commit nem push: o dono do repositório faz isso.
