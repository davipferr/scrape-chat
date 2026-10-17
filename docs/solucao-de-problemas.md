# Quando algo dá errado

**"O agente não conseguiu entrar na sua conta Claude" / "OAuth session expired".**
O agente usa o login do Claude Code desta máquina quando não há `ANTHROPIC_API_KEY`. Rode `npx @anthropic-ai/claude-code` (ou `claude`, se tiver instalado), digite `/login`, depois `/exit`, e reinicie o servidor. Ou preencha `ANTHROPIC_API_KEY` no `.env`. O passo a passo está no README, em "Conta do Claude". Uma linha `ANTHROPIC_API_KEY=` vazia é ignorada de propósito, para não esconder o login.

**"Servidor desligado" na barra lateral.**
A interface não alcança `http://127.0.0.1:8787`. Use `npm run dev` (sobe os dois) ou `npm run server` em outro terminal. Se a porta estiver ocupada, mude `SCRAPE_CHAT_PORT`.

**O agente responde, mas não aparece tabela.**
Abra **Como foi feito** no job (ou o histórico). Se o job estiver **Fora do formato**, o painel mostra a regra do contrato que falhou; `npm run job -- check <id>` mostra todas. Se nem o job aparecer, o agente não usou a skill `scrape-task`: confira `npm run validate`.

**Job "Bloqueado".**
O site respondeu 403, 429, CAPTCHA ou "checking your browser". O scrape-chat não contorna bloqueios. Tente a API oficial do site, uma exportação que ele ofereça, outra fonte com os mesmos dados ou, se a página exige login, aprove o uso do seu Chrome logado (`--auto-connect`).

**Tabela vazia ou incompleta numa página que tem dados.**
Peça de novo dizendo o que faltou ("a lista carrega ao rolar", "os preços aparecem depois de escolher a cidade"). O agente sobe a escada do [escolher-motor.md](../skills/scrape-task/references/escolher-motor.md#quando-falha): renderização JS, rolagem e, por fim, o navegador local.

**Um job ficou "Rodando" e não termina.**
Abra a conversa dele (ou o job no histórico) e clique em **Parar**. O agente recebe o aviso na hora; se estiver travado numa ferramenta, o turno é fechado mesmo assim depois de 5 segundos e a conversa aceita mensagem nova. O job vira **Interrompido** e ganha o botão **Tentar de novo**.

**Um job aparece como "Interrompido" sem eu ter parado.**
O servidor caiu ou foi reiniciado no meio da resposta. Ao subir de novo, ele fecha esses turnos com o aviso "o servidor foi reiniciado no meio da resposta". A conversa é salva a cada evento, então o que o agente já tinha feito continua lá.

**Erro no console: "A listener indicated an asynchronous response by returning true, but the message channel closed".**
Vem de uma extensão do navegador, não do scrape-chat. Pode ignorar, ou abrir numa janela anônima sem extensões para confirmar.

**A tela de Monitores diz para preencher a SGAI_API_KEY.**
Os monitores vivem na ScrapeGraph AI e o servidor fala com ela pela chave do `.env`. Preencha e reinicie o servidor.

**O navegador local não abre.**
O motor `browser` precisa do Chrome ou Chromium instalado. `npx browse status` mostra o que ele encontrou.

**Editei uma skill em `skills/` e nada mudou.**
O CLI do skills.sh copia as skills locais para `.claude/skills/`. Rode `npm run setup` de novo; `npm run validate` avisa quando a cópia ficou para trás.

**Quero ver a interface sem gastar nada.**
`npm run dev -- --fake`. O agente de teste encena um job de tabela (ou de páginas, se a mensagem falar em Markdown) e pede aprovação se a mensagem falar em "monitor".
