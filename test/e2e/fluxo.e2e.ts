// Ponta a ponta: sobe o servidor de verdade (processo separado, `node src/server/main.ts`)
// com o agente de teste e uma pasta de dados temporária, e usa a API como a interface
// usa: atalho, SSE, aprovação, job, editor de campos, atalho salvo, monitores e
// reinício do servidor. Rode com `npm run e2e` (compila a interface antes).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEvent } from '../../src/server/events.ts';
import { SHORTCUTS, compose } from '../../web/src/shortcuts.ts';
import { fieldsToSchema, schemaToFields } from '../../web/src/table.ts';

const dataRoot = mkdtempSync(join(tmpdir(), 'scrape-chat-e2e-'));
let port = 0;
let server: ChildProcess | null = null;
let logs = '';
const base = () => `http://127.0.0.1:${port}`;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

async function start(): Promise<void> {
  server = spawn(process.execPath, ['src/server/main.ts'], {
    env: { ...process.env, SCRAPE_CHAT_FAKE_AGENT: '1', SCRAPE_CHAT_DATA_ROOT: dataRoot, SCRAPE_CHAT_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => (logs += d));
  server.stderr!.on('data', (d) => (logs += d));
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base()}/api/health`).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`o servidor não subiu:\n${logs}`);
}

async function stop(): Promise<void> {
  if (!server) return;
  const exited = new Promise((r) => server!.once('exit', r));
  server.kill();
  await exited;
  server = null;
}

async function api<T = Record<string, unknown>>(path: string, body?: unknown, method?: string): Promise<{ status: number; body: T }> {
  const res = await fetch(base() + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

/** Manda uma mensagem e lê o SSE até o fim do turno, aprovando o que for pedido se `approve`. */
async function turn(chatId: string, text: string, approve?: boolean): Promise<ChatEvent[]> {
  const { body: chat } = await api<{ events: ChatEvent[] }>(`/api/chats/${chatId}`);
  const after = chat.events.at(-1)?.seq ?? 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const res = await fetch(`${base()}/api/chats/${chatId}/stream?after=${after}`, { signal: controller.signal });
  assert.equal((await api(`/api/chats/${chatId}/messages`, { text })).status, 202);
  const events: ChatEvent[] = [];
  let buffer = '';
  const decoder = new TextDecoder();
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const data = buffer
          .slice(0, end)
          .split('\n')
          .find((l) => l.startsWith('data: '));
        buffer = buffer.slice(end + 2);
        if (!data) continue;
        const event = JSON.parse(data.slice(6)) as ChatEvent;
        events.push(event);
        if (event.type === 'approval' && approve !== undefined) await api(`/api/chats/${chatId}/approvals/${event.approvalId}`, { allow: approve });
        if (event.type === 'done') return events;
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  throw new Error('o turno não terminou');
}

const lastJob = (events: ChatEvent[]) => {
  const jobs = events.filter((e) => e.type === 'job');
  const last = jobs.at(-1);
  assert.ok(last && last.type === 'job', 'o turno não mostrou nenhum job');
  return last.job;
};

before(async () => {
  port = await freePort();
  await start();
});

after(async () => {
  await stop();
  rmSync(dataRoot, { recursive: true, force: true });
});

let chatId = '';
let firstJobId = '';

test('a interface compilada abre e carrega seus arquivos', { skip: !existsSync('web/dist/index.html') && 'rode npm run build' }, async () => {
  const html = await (await fetch(`${base()}/`)).text();
  assert.match(html, /<div id="root">/);
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  assert.ok(asset, 'index.html sem o script da interface');
  const js = await fetch(base() + asset);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') ?? '', /javascript/);
});

test('health mostra o agente de teste', async () => {
  const { body } = await api<{ fakeAgent: boolean }>('/api/health');
  assert.equal(body.fakeAgent, true);
});

test('atalho "Extrair a lista" vira um job com tabela válida', async () => {
  const composed = compose(SHORTCUTS.find((s) => s.id === 'list')!, 'https://loja.example/notebooks só os acima de R$ 3000');
  assert.ok(composed.ok);
  chatId = (await api<{ id: string }>('/api/chats', {})).body.id;
  const events = await turn(chatId, composed.message);

  const types = events.map((e) => e.type);
  assert.equal(types[0], 'user');
  assert.ok(types.includes('text-delta'), 'sem texto ao vivo');
  assert.equal(types.at(-1), 'done');
  const job = lastJob(events);
  assert.equal(job.status, 'done');
  assert.equal(job.items, 6);
  firstJobId = job.id;

  const { body: detail } = await api<{ issues: unknown[]; result: { rows: unknown[] } }>(`/api/jobs/${job.id}`);
  assert.deepEqual(detail.issues, [], 'o resultado precisa passar no contrato');
  assert.equal(detail.result.rows.length, 6);
  assert.ok(existsSync(join(dataRoot, 'data/jobs', job.id, 'job.json')), 'o job foi para a pasta de dados de teste');
});

test('monitor pede aprovação e segue quando o usuário permite', async () => {
  const events = await turn(chatId, 'Monitore https://loja.example/notebooks uma vez por dia', true);
  const approval = events.find((e) => e.type === 'approval');
  const resolved = events.find((e) => e.type === 'approval-resolved');
  assert.ok(approval && approval.type === 'approval' && /monitor/.test(approval.reason));
  assert.ok(resolved && resolved.type === 'approval-resolved' && resolved.allowed);
});

test('editor de campos: refazer com outro schema cria um job novo, sem apagar o antigo', async () => {
  const { body } = await api<{ job: { schema: Record<string, unknown>; goal: string } }>(`/api/jobs/${firstJobId}`);
  const fields = schemaToFields(body.job.schema).filter((f) => f.name !== 'avaliacao');
  const schema = JSON.stringify(fieldsToSchema([...fields, { name: 'parcelas', type: 'inteiro', description: '', required: false }]));
  const events = await turn(chatId, `Refaça o job ${firstJobId} ("${body.job.goal}") com estes campos.\n\n\`\`\`json\n${schema}\n\`\`\``);
  const job = lastJob(events);
  assert.notEqual(job.id, firstJobId);
  const { body: jobs } = await api<{ id: string; chatId: string }[]>('/api/jobs');
  assert.ok(jobs.some((j) => j.id === firstJobId && j.chatId === chatId), 'o job antigo continua no histórico, ligado à conversa');
});

test('atalho salvo repete o pedido numa conversa nova', async () => {
  const { body: saved } = await api<{ id: string; text: string }>('/api/shortcuts', { label: 'Notebooks da loja', text: 'Baixe em Markdown as páginas de https://docs.example.com/guia' });
  const fresh = (await api<{ id: string }>('/api/chats', {})).body.id;
  const events = await turn(fresh, saved.text);
  const job = lastJob(events);
  assert.equal(job.shape, 'documents');
  assert.equal(job.items, 3);
  assert.equal((await api(`/api/shortcuts/${saved.id}`, undefined, 'DELETE')).status, 200);
});

test('monitores: listar, ver mudanças e pausar', async () => {
  const { body } = await api<{ available: boolean; monitors: { id: string; status: string }[] }>('/api/monitors');
  assert.equal(body.available, true);
  const first = body.monitors[0]!;
  const { body: ticks } = await api<{ changed: boolean }[]>(`/api/monitors/${first.id}/activity`);
  assert.ok(ticks.some((t) => t.changed));
  assert.equal((await api<{ status: string }>(`/api/monitors/${first.id}/pause`, {})).body.status, 'paused');
});

test('depois de reiniciar, conversas e jobs continuam lá', async () => {
  await stop();
  await start();
  const { body: chats } = await api<{ id: string }[]>('/api/chats');
  assert.ok(chats.some((c) => c.id === chatId));
  const { body: chat } = await api<{ events: ChatEvent[]; sdkSessionId: string | null }>(`/api/chats/${chatId}`);
  assert.ok(chat.sdkSessionId, 'a sessão do agente foi guardada para continuar a conversa');
  assert.ok(chat.events.filter((e) => e.type === 'done').length >= 3);
  assert.equal((await api(`/api/jobs/${firstJobId}`)).status, 200);
});
