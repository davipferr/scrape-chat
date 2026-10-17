# scrape-chat

Web scraper com IA numa interface de chat. Você cola um link e diz o que quer dele ("nome, preço e avaliação de cada notebook", "a documentação inteira em Markdown", "me avise quando a página de promoções mudar"), ou só clica num atalho. O agente escolhe como raspar, roda, confere o resultado e devolve uma tabela pronta para baixar.

```
 você ──► chat (React) ──► servidor (Node + Claude Agent SDK) ──► skills: scrape-task → just-scrape / browser
                ▲                                                              │
                └────────── tabela · páginas · CSV · JSON ◄── data/jobs/<id>/ ─┘
```

## Começar

Precisa de Node ≥ 22.18. Os CLIs dos motores (`just-scrape`, `browse`) vêm fixados no `package.json`; nada é instalado global.

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run dev
```

Abra http://localhost:5173.

Para conhecer a interface sem gastar nada: `npm run dev -- --fake`. Um agente de teste encena jobs completos e a tela de Monitores mostra monitores de exemplo. Para raspar de verdade, configure as duas contas abaixo.

### Conta da ScrapeGraph AI (o motor de scraping)

1. Crie a conta em [scrapegraphai.com/signup](https://scrapegraphai.com/signup). O plano grátis vem com 500 créditos.
2. Copie a chave em [scrapegraphai.com/dashboard](https://scrapegraphai.com/dashboard).
3. Copie `.env.example` para `.env` e preencha `SGAI_API_KEY=sua-chave`.

Sem essa chave, o agente só usa o navegador local, e a tela de Monitores fica vazia.

### Conta do Claude (o agente do chat)

O agente é o Claude Code rodando como biblioteca (o Claude Agent SDK). **Não precisa instalar nada a mais:** o `npm install` já baixou o SDK, e o Claude Code vem dentro dele. Falta só dizer com qual conta ele entra. Escolha um dos dois jeitos:

**Jeito 1: login da sua conta Claude, sem API key.** O uso conta nos limites da sua assinatura do Claude. Vale para uso pessoal, nesta máquina.

1. Abra o Claude Code no terminal. O `npx` baixa e abre na hora, sem instalar nada global:

   ```bash
   npx @anthropic-ai/claude-code
   ```

   Se você já tem o comando `claude` instalado, pode rodar só `claude`.
2. Dentro do Claude Code, digite `/login`, escolha a sua conta Claude e confirme no navegador que abrir.
3. Digite `/exit` para sair. O login fica salvo no seu usuário (na pasta `.claude` da sua pasta pessoal), e o scrape-chat passa a usá-lo.
4. Reinicie o scrape-chat (`npm run dev`).

A sessão pode expirar depois de um tempo. Se o chat avisar que não conseguiu entrar na sua conta Claude, repita os passos 1 a 3.

**Jeito 2: API key, pagando por uso.**

1. Crie uma chave em [console.anthropic.com](https://console.anthropic.com).
2. No `.env`, preencha `ANTHROPIC_API_KEY=sua-chave`.
3. Reinicie o scrape-chat.

Quando a chave está preenchida, ela tem preferência sobre o login. Uma linha `ANTHROPIC_API_KEY=` vazia é ignorada, então pode deixá-la no `.env` se for usar o login.

## Usar

**Conversa.** Escreva o pedido do seu jeito. O agente cria um job, mostra os passos enquanto trabalha e, quando os dados chegam, abre a tabela ao lado. Se ele precisar de algo que gasta mais (um monitor, um crawl grande, o seu Chrome logado), aparece um pedido de aprovação com **Permitir** e **Não permitir**.

**Atalhos.** Cole um link no campo e clique num atalho embaixo dele. O resto do texto vira instrução extra ("só os acima de R$ 3000").

| Atalho | O que pede ao agente |
|---|---|
| Extrair a lista | Cada item da página vira uma linha, com os campos óbvios |
| Todas as páginas | O mesmo, seguindo a paginação até 10 páginas |
| Tabelas da página | As tabelas que já existem, linha por linha |
| Texto em Markdown | O conteúdo principal, sem menus |
| Seção inteira | Todas as páginas abaixo do endereço, até 20 |
| Avisar quando mudar | Monitor diário (pede aprovação) |
| Buscar na web | Sem link: procura as fontes e monta a tabela |

Embaixo de cada job pronto aparecem os próximos passos: **Rodar de novo**, **Seguir a paginação**, **Avisar quando mudar**.

**Painel do job.**

- **Dados** (ou **Páginas**): busca sem acento, ordenação pelo cabeçalho, escolha de colunas, a linha inteira num clique. **Baixar** entrega o que está na tela em CSV, CSV para Excel (`;` e vírgula decimal), JSON ou Markdown. Células que começam com `=`, `+`, `-` ou `@` ganham um apóstrofo para não virarem fórmula na planilha.
- **Decidido sem perguntar**: as suposições do agente. **Mudar** começa a mensagem de correção para você.
- **Campos**: o schema como formulário. Mude, tire ou acrescente campos e clique em **Refazer com estes campos**; sai um job novo e o antigo continua salvo.
- **Como foi feito**: o pedido, o endereço, a instrução de extração e os comandos que rodaram.
- **Salvar como atalho**: guarda o pedido em **Meus atalhos**, na barra lateral. Um clique lá repete o pedido numa conversa nova.

**Histórico de jobs.** Tudo o que já foi raspado, de todas as conversas, com busca e filtro. **Abrir conversa** volta para onde o job nasceu.

**Monitores.** Os monitores da sua conta na ScrapeGraph AI: quando cada um confere a página, as últimas execuções e as linhas que entraram ou saíram. **Pausar**, **Retomar** e **Apagar** agem direto na ScrapeGraph, sem gastar o agente. Para criar um, use o atalho "Avisar quando mudar" na conversa.

## Testes

| Comando | O que cobre | Gasta? |
|---|---|---|
| `npm run check` | Typecheck do servidor e da interface, testes de unidade e de API (contrato, política do agente, SSE, atalhos, tabela), validação das skills | Não |
| `npm run e2e` | Compila a interface, sobe o servidor de verdade com o agente de teste numa pasta temporária e percorre o fluxo inteiro: atalho, SSE, aprovação, editor de campos, atalho salvo, monitores e reinício | Não |
| `npm run e2e:real -- --gastar` | Um pedido pequeno (`https://example.com`) com o agente e os motores de verdade; confere se saiu um job válido | Sim, pouco |

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor + interface (Vite) juntos, recarregando ao salvar. `-- --fake` usa o agente de teste |
| `npm run build` | Compila a interface em `web/dist/` |
| `npm run server` | Só o servidor, em http://127.0.0.1:8787. Com `web/dist/` compilado, ele também serve a interface |
| `npm run setup` | Instala as skills do `skills.json` e da pasta `skills/` (`-- --dry-run` só mostra os comandos) |
| `npm run validate` | Confere se as skills estão instaladas e seguem o padrão |
| `npm run job -- new <apelido>` | Cria a pasta de um job novo |
| `npm run job -- check <id>` ou `--latest` | Confere `job.json` e `result.json` contra o contrato |

## Mais

- [Como funciona por dentro](docs/arquitetura.md): skills, servidor, eventos, contrato dos jobs, API e o que o agente pode ou não fazer.
- [Quando algo dá errado](docs/solucao-de-problemas.md).
- [Contrato dos jobs](skills/scrape-task/references/contrato-dos-jobs.md) e [como o motor é escolhido](skills/scrape-task/references/escolher-motor.md).

## Limites

- Cada chamada à ScrapeGraph gasta créditos, e cada mensagem gasta API do Claude (com teto em `SCRAPE_CHAT_MAX_USD`, padrão US$ 2 por mensagem).
- O projeto não contorna CAPTCHA nem bloqueio anti-bot, não usa proxies e só entra em páginas logadas com a sua própria sessão, depois da sua aprovação. Quando um site bloqueia, o job termina como **Bloqueado** e o agente sugere outro caminho. Confira os termos de uso de cada site.
- O servidor escuta só em `127.0.0.1` e não tem login: é uma ferramenta para a sua máquina.
