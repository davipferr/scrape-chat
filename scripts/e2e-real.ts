// npm run e2e:real -- --gastar [-- --url <endereço>]
//
// Um teste de ponta a ponta DE VERDADE: sobe o servidor com o agente real, manda
// um pedido pequeno e confere se saiu um job válido. Gasta um pouco de API do
// Claude e créditos da ScrapeGraph, por isso só roda com --gastar.
// O job e a conversa ficam em data/, como qualquer outro.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { parseArgs } from 'node:util';
import type { ChatEvent } from '../src/server/events.ts';
import { loadConfig } from '../src/server/config.ts';
import { bold, dim, green, red, yellow } from './lib/project.ts';

const { values } = parseArgs({ options: { gastar: { type: 'boolean' }, url: { type: 'string' }, minutos: { type: 'string' } } });
const target = values.url ?? 'https://example.com';
const request = `Extraia o título e o primeiro parágrafo de ${target}. É um teste: faça o mínimo, sem paginação nem crawl.`;
const timeoutMs = Number(values.minutos ?? 10) * 60_000;

if (!values.gastar) {
  console.log(`${bold('Teste real de ponta a ponta')}

Sobe o servidor com o agente de verdade e pede:
  ${dim(request)}

Isso gasta API do Claude (até SCRAPE_CHAT_MAX_USD por mensagem) e alguns créditos
da ScrapeGraph. Para rodar mesmo:

  npm run e2e:real -- --gastar
`);
  process.exit(0);
}

const config = loadConfig();
if (!process.env.SGAI_API_KEY) console.log(yellow('aviso: sem SGAI_API_KEY; o agente deve cair no navegador local (precisa do Chrome instalado).'));

const port = await new Promise<number>((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => resolve(p));
  });
});
const base = `http://127.0.0.1:${port}`;
const env: NodeJS.ProcessEnv = { ...process.env, SCRAPE_CHAT_PORT: String(port) };
delete env.SCRAPE_CHAT_FAKE_AGENT;
const server = spawn(process.execPath, ['src/server/main.ts'], { cwd: config.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', (d) => (logs += d));
server.stderr.on('data', (d) => (logs += d));

const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const fail = (message: string): never => {
  console.error(red(`\n✖ ${message}`));
  if (logs.trim()) console.error(dim(`\nsaída do servidor:\n${logs.trim()}`));
  server.kill();
  process.exit(1);
};

try {
  for (let i = 0; ; i++) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    if (i > 100) fail('o servidor não subiu');
    await new Promise((r) => setTimeout(r, 100));
  }

  const chat = (await (await post('/api/chats', {})).json()) as { id: string };
  console.log(`${bold('Pedido:')} ${request}\n${dim(`conversa ${chat.id}`)}\n`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const stream = await fetch(`${base}/api/chats/${chat.id}/stream`, { signal: controller.signal });
  await post(`/api/chats/${chat.id}/messages`, { text: request });

  let done = null as Extract<ChatEvent, { type: 'done' }> | null;
  const jobs = new Map<string, Extract<ChatEvent, { type: 'job' }>['job']>();
  let buffer = '';
  const decoder = new TextDecoder();
  try {
    outer: for await (const chunk of stream.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const line = buffer.slice(0, end).split('\n').find((l) => l.startsWith('data: '));
        buffer = buffer.slice(end + 2);
        if (!line) continue;
        const e = JSON.parse(line.slice(6)) as ChatEvent;
        if (e.type === 'tool') console.log(dim(`  ${e.name}: ${e.summary}`));
        if (e.type === 'text') console.log(`\n${e.text}\n`);
        if (e.type === 'job') jobs.set(e.job.id, e.job);
        if (e.type === 'approval') {
          // Um teste não aprova gasto extra: nega e deixa o agente seguir sem.
          console.log(yellow(`  pedido de aprovação negado pelo teste: ${e.reason}`));
          await post(`/api/chats/${chat.id}/approvals/${e.approvalId}`, { allow: false });
        }
        if (e.type === 'done') {
          done = e;
          break outer;
        }
      }
    }
  } catch {
    fail(`o agente não terminou em ${timeoutMs / 60_000} min`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }

  const turn = done ?? fail('o stream acabou sem o fim do turno');
  if (!turn.ok) fail(`o agente parou com erro: ${turn.error}`);
  const job = [...jobs.values()].at(-1) ?? fail('o agente respondeu, mas não criou nenhum job em data/jobs/');
  const detail = (await (await fetch(`${base}/api/jobs/${job.id}`)).json()) as { issues: { level: string; message: string }[]; result: { status: string } | null };
  const errors = detail.issues.filter((i) => i.level === 'error');
  const result = detail.result ?? fail(`o job ${job.id} não tem result.json`);
  if (errors.length) fail(`o job ${job.id} não passou no contrato: ${errors.map((i) => i.message).join('; ')}`);
  if (result.status !== 'done' && result.status !== 'partial') fail(`o job ${job.id} terminou como ${result.status}`);

  console.log(
    green(`✔ job ${job.id}: ${result.status}, ${job.items} ${job.shape === 'documents' ? 'página(s)' : 'linha(s)'}`) +
      dim(`  (${(turn.durationMs / 1000).toFixed(1)} s, US$ ${turn.costUsd.toFixed(2)} de agente)`),
  );
} finally {
  server.kill();
}
