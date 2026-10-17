import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner, TurnRequest } from '../src/server/agent.ts';
import { createApp } from '../src/server/app.ts';
import { ChatStore, RESTART_ERROR } from '../src/server/chats.ts';
import type { ChatEvent } from '../src/server/events.ts';
import { JobStore } from '../src/jobs/store.ts';
import { SavedShortcutStore } from '../src/server/saved.ts';
import { createFakeMonitors, createScrapeGraphMonitors } from '../src/server/monitors.ts';

// Os exemplos do contrato viram o job que o agente falso "grava".
const doc = readFileSync('skills/scrape-task/references/contrato-dos-jobs.md', 'utf8');
const [jobExample, resultExample] = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);
const jobId = (JSON.parse(jobExample!) as { id: string }).id;

const sdk = (m: unknown) => m as SDKMessage;
const init = sdk({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', session_id: 'sessao-1' });
const say = (text: string) => sdk({ type: 'assistant', parent_tool_use_id: null, session_id: 'sessao-1', message: { id: 'm1', content: [{ type: 'text', text }] } });
const bash = (id: string, command: string) =>
  sdk({ type: 'assistant', parent_tool_use_id: null, session_id: 'sessao-1', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
const toolResult = (id: string, content: string, is_error = false) =>
  sdk({ type: 'user', parent_tool_use_id: null, session_id: 'sessao-1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
const result = sdk({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.12, duration_ms: 900, session_id: 'sessao-1' });

async function setup(script: (req: TurnRequest, root: string) => AsyncGenerator<SDKMessage>, monitors = createFakeMonitors()) {
  const root = mkdtempSync(join(tmpdir(), 'scrape-chat-'));
  mkdirSync(join(root, 'web/dist'), { recursive: true });
  writeFileSync(join(root, 'web/dist/index.html'), '<!doctype html><title>ok</title>');
  writeFileSync(join(root, 'segredo.txt'), 'nao');
  const requests: TurnRequest[] = [];
  const runner: AgentRunner = (req) => {
    requests.push(req);
    return script(req, root);
  };
  const jobs = new JobStore(root);
  const chats = new ChatStore(root, runner, jobs, { stopGraceMs: 100 });
  jobs.isActive = (id) => chats.isJobActive(id);
  const server = createApp({ chats, jobs, shortcuts: new SavedShortcutStore(root), monitors, health: () => ({ ok: true }), staticDir: join(root, 'web/dist') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (path: string, init?: { method?: string; body?: unknown }) => {
    const res = await fetch(base + path, {
      method: init?.method ?? (init?.body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json' },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  /** Lê o SSE até `until` aceitar um evento (ou 5 s). */
  const stream = async (chatId: string, until: (e: ChatEvent) => boolean, onEvent?: (e: ChatEvent) => void) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${base}/api/chats/${chatId}/stream`, { signal: controller.signal });
    const events: ChatEvent[] = [];
    let buffer = '';
    const decoder = new TextDecoder();
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!data) continue;
          const event = JSON.parse(data.slice(6)) as ChatEvent;
          events.push(event);
          onEvent?.(event);
          if (until(event)) return events;
        }
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    return events;
  };
  const close = () => {
    server.closeAllConnections();
    server.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { root, base, api, stream, close, requests, chats, jobs };
}

const writeJob = (root: string, withResult: boolean) => {
  const dir = join(root, 'data/jobs', jobId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'job.json'), jobExample!);
  if (withResult) writeFileSync(join(dir, 'result.json'), resultExample!);
};

test('um turno: texto, ferramenta, job com resultado e fim', async () => {
  const app = await setup(async function* (_req, root) {
    yield init;
    yield bash('t1', 'npm run --silent job -- new "precos"');
    writeJob(root, false);
    yield toolResult('t1', `data/jobs/${jobId}`);
    yield bash('t2', `npx just-scrape extract "https://loja.example" --json > data/jobs/${jobId}/raw/1.json`);
    writeJob(root, true);
    yield toolResult('t2', '');
    yield say('Achei 1 notebook.');
    yield result;
  });
  try {
    const { body: chat } = await app.api('/api/chats', { body: {} });
    const listening = app.stream(chat.id as string, (e) => e.type === 'done');
    assert.equal((await app.api(`/api/chats/${chat.id}/messages`, { body: { text: 'preços dos notebooks' } })).status, 202);
    const events = await listening;
    assert.deepEqual(
      events.map((e) => e.type),
      ['user', 'session', 'tool', 'tool-result', 'job', 'tool', 'tool-result', 'job', 'text', 'done'],
    );
    const jobs = events.filter((e) => e.type === 'job').map((e) => (e.type === 'job' ? e.job.status : ''));
    assert.deepEqual(jobs, ['running', 'done']);

    const { body: saved } = await app.api(`/api/chats/${chat.id}`);
    assert.equal(saved.title, 'preços dos notebooks');
    assert.equal(saved.sdkSessionId, 'sessao-1');
    assert.equal((await app.api('/api/jobs')).body[0] !== undefined, true);
    const { body: detail } = await app.api(`/api/jobs/${jobId}`);
    assert.deepEqual(detail.issues, []);
  } finally {
    app.close();
  }
});

test('a segunda mensagem continua a mesma sessão do SDK', async () => {
  const app = await setup(async function* () {
    yield init;
    yield say('oi');
    yield result;
  });
  try {
    const { body: chat } = await app.api('/api/chats', { body: {} });
    for (const text of ['um', 'dois']) {
      const done = app.stream(chat.id as string, (e) => e.type === 'done' && e.seq > (text === 'um' ? 0 : 4));
      await app.api(`/api/chats/${chat.id}/messages`, { body: { text } });
      await done;
    }
    assert.deepEqual(
      app.requests.map((r) => r.resume),
      [null, 'sessao-1'],
    );
  } finally {
    app.close();
  }
});

test('ação que pede aprovação espera o clique do usuário', async () => {
  const decisions: string[] = [];
  const app = await setup(async function* (req) {
    yield init;
    const command = 'npx just-scrape monitor create --url "https://a.com" --interval 1d';
    yield bash('t1', command);
    const answer = await req.canUseTool('Bash', { command }, { signal: req.abortController.signal } as never);
    decisions.push(answer?.behavior ?? "null");
    const denied = await req.canUseTool('Bash', { command: 'npx just-scrape scrape "https://a.com" --stealth' }, { signal: req.abortController.signal } as never);
    decisions.push(denied?.behavior ?? "null");
    yield result;
  });
  try {
    const { body: chat } = await app.api('/api/chats', { body: {} });
    const events = app.stream(
      chat.id as string,
      (e) => e.type === 'done',
      (e) => {
        if (e.type === 'approval') void app.api(`/api/chats/${chat.id}/approvals/${e.approvalId}`, { body: { allow: true } });
      },
    );
    await app.api(`/api/chats/${chat.id}/messages`, { body: { text: 'monitore' } });
    const types = (await events).map((e) => e.type);
    assert.ok(types.includes('approval') && types.includes('approval-resolved'));
    assert.deepEqual(decisions, ['allow', 'deny']);
  } finally {
    app.close();
  }
});

test('mensagem durante um turno dá 409; stop interrompe', async () => {
  const app = await setup(async function* (req) {
    yield init;
    await new Promise<void>((resolve) => req.abortController.signal.addEventListener('abort', () => resolve()));
    throw new Error('aborted');
  });
  try {
    const { body: chat } = await app.api('/api/chats', { body: {} });
    const events = app.stream(chat.id as string, (e) => e.type === 'done');
    await app.api(`/api/chats/${chat.id}/messages`, { body: { text: 'demora' } });
    assert.equal((await app.api(`/api/chats/${chat.id}/messages`, { body: { text: 'de novo' } })).status, 409);
    assert.equal((await app.api(`/api/chats/${chat.id}/stop`, { method: 'POST' })).body.stopped, true);
    const done = (await events).at(-1)!;
    assert.equal(done.type === 'done' && done.error, 'interrompido');
  } finally {
    app.close();
  }
});

test('erros de entrada viram 400/404', async () => {
  const app = await setup(async function* () {});
  try {
    assert.equal((await app.api('/api/chats/nao-existe')).status, 404);
    const { body: chat } = await app.api('/api/chats', { body: {} });
    assert.equal((await app.api(`/api/chats/${chat.id}/messages`, { body: { text: '  ' } })).status, 400);
    assert.equal((await app.api('/api/jobs/nao-e-um-id')).status, 404);
    assert.equal((await app.api('/api/nada')).status, 404);
  } finally {
    app.close();
  }
});

test('a interface compilada é servida, sem sair da pasta', async () => {
  const app = await setup(async function* () {});
  try {
    const page = await fetch(`${app.base}/conversa/qualquer`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>ok/);
    for (const path of ['/..%2f..%2fsegredo.txt', '/%2e%2e/segredo.txt']) {
      const res = await fetch(app.base + path);
      assert.notEqual(await res.text(), 'nao');
    }
    assert.equal((await app.api('/api/health')).status, 200);
  } finally {
    app.close();
  }
});

test('atalhos salvos: criar, listar, validar e apagar', async () => {
  const app = await setup(async function* () {});
  try {
    const { status, body } = await app.api('/api/shortcuts', { body: { label: 'Preços da loja', text: 'Extraia os preços de https://loja.example' } });
    assert.equal(status, 201);
    const list = (await app.api('/api/shortcuts')).body as unknown as { id: string; label: string }[];
    assert.deepEqual(list.map((s) => s.label), ['Preços da loja']);
    assert.equal((await app.api('/api/shortcuts', { body: { label: '  ', text: 'x' } })).status, 400);
    assert.equal((await app.api(`/api/shortcuts/${body.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await app.api(`/api/shortcuts/${body.id}`, { method: 'DELETE' })).status, 404);
    assert.equal(JSON.parse(readFileSync(join(app.root, 'data/shortcuts.json'), 'utf8')).length, 0);
  } finally {
    app.close();
  }
});

test('monitores: listar com o job dono, ver mudanças, pausar e apagar', async () => {
  const app = await setup(async function* () {});
  try {
    const dir = join(app.root, 'data/jobs', jobId);
    mkdirSync(dir, { recursive: true });
    const job = JSON.parse(jobExample!);
    writeFileSync(join(dir, 'job.json'), JSON.stringify({ ...job, operation: 'monitor', shape: 'documents', schema: null }));
    const base = JSON.parse(resultExample!);
    delete base.columns;
    delete base.rows;
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ ...base, documents: [{ url: 'https://x', markdown: 'x' }], monitor: { id: 'fake-promocoes', url: 'https://loja.example/promocoes', interval: '1d' } }));

    const { body } = await app.api('/api/monitors');
    const list = body.monitors as { id: string; jobId: string | null }[];
    assert.equal(body.available, true);
    assert.deepEqual(list.map((m) => [m.id, m.jobId]), [['fake-promocoes', jobId], ['fake-precos', null]]);

    const ticks = (await app.api('/api/monitors/fake-promocoes/activity')).body as unknown as { changed: boolean }[];
    assert.deepEqual(ticks.map((t) => t.changed), [true, false, false]);
    assert.equal((await app.api('/api/monitors/fake-promocoes/pause', { method: 'POST' })).body.status, 'paused');
    assert.equal((await app.api('/api/monitors/fake-precos', { method: 'DELETE' })).status, 200);
    assert.equal((await app.api('/api/monitors/fake-precos/activity')).status, 404);
  } finally {
    app.close();
  }
});

test('sem SGAI_API_KEY os monitores explicam o que falta', async () => {
  const app = await setup(async function* () {}, createScrapeGraphMonitors(undefined));
  try {
    const { body } = await app.api('/api/monitors');
    assert.equal(body.available, false);
    assert.match(String(body.reason), /SGAI_API_KEY/);
    assert.equal((await app.api('/api/monitors/x/pause', { method: 'POST' })).status, 503);
  } finally {
    app.close();
  }
});

test('o histórico de jobs diz de qual conversa cada um saiu', async () => {
  const app = await setup(async function* (_req, root) {
    yield init;
    writeJob(root, true);
    yield bash('t1', `npm run job -- check ${jobId}`);
    yield toolResult('t1', 'ok');
    yield result;
  });
  try {
    const { body: chat } = await app.api('/api/chats', { body: {} });
    const done = app.stream(chat.id as string, (e) => e.type === 'done');
    await app.api(`/api/chats/${chat.id}/messages`, { body: { text: 'x' } });
    await done;
    const jobs = (await app.api('/api/jobs')).body as unknown as { id: string; chatId: string }[];
    assert.deepEqual(jobs.map((j) => [j.id, j.chatId]), [[jobId, chat.id]]);
  } finally {
    app.close();
  }
});

test('o SSE responde na hora, mesmo sem eventos', async () => {
  const app = await setup(async function* () {});
  try {
    const { body: chat } = await app.api('/api/chats', { body: {} });
    const controller = new AbortController();
    const started = Date.now();
    const res = await fetch(`${app.base}/api/chats/${chat.id}/stream`, { signal: controller.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.ok(Date.now() - started < 1000, 'os cabeçalhos não podem esperar o primeiro evento');
    controller.abort();
  } finally {
    app.close();
  }
});

test('Parar fecha o turno mesmo com o agente travado, e o job vira interrompido', async () => {
  const app = await setup(async function* (_req, root) {
    yield init;
    yield bash('t1', 'npm run --silent job -- new "travado"');
    writeJob(root, false);
    yield toolResult('t1', `data/jobs/${jobId}`);
    // Trava sem olhar o abort, como uma ferramenta que nunca responde.
    await new Promise(() => {});
  });
  try {
    const { body: chat } = await app.api('/api/chats', { body: {} });
    const events = app.stream(chat.id as string, (e) => e.type === 'job' && e.job.status === 'stopped');
    await app.api(`/api/chats/${chat.id}/messages`, { body: { text: 'trava' } });
    await new Promise((r) => setTimeout(r, 100));
    const statusNow = async () => ((await app.api('/api/jobs')).body as unknown as { status: string }[])[0]!.status;
    assert.equal(await statusNow(), 'running');
    assert.equal((await app.api(`/api/chats/${chat.id}/stop`, { method: 'POST' })).body.stopped, true);
    const list = await events;
    const done = list.find((e) => e.type === 'done');
    assert.equal(done?.type === 'done' && done.error, 'interrompido');
    assert.equal((await app.api(`/api/chats/${chat.id}`)).body.running, false);
    assert.equal(await statusNow(), 'stopped');
    // A conversa aceita mensagem nova logo depois.
    assert.notEqual((await app.api(`/api/chats/${chat.id}/messages`, { body: { text: 'de novo' } })).status, 409);
  } finally {
    app.close();
  }
});

test('turno que ficou aberto por um reinício é fechado ao subir o servidor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scrape-chat-'));
  try {
    mkdirSync(join(root, 'data/chats'), { recursive: true });
    const orphan = { id: 'c1', title: 'x', createdAt: '2026-10-17T00:00:00Z', sdkSessionId: 's', events: [{ type: 'user', text: 'oi', seq: 1, at: '' }] };
    writeFileSync(join(root, 'data/chats/c1.json'), JSON.stringify(orphan));
    const chats = new ChatStore(root, async function* () {}, new JobStore(root));
    const last = chats.get('c1')!.events.at(-1)!;
    assert.equal(last.type === 'done' && last.error, RESTART_ERROR);
    const saved = JSON.parse(readFileSync(join(root, 'data/chats/c1.json'), 'utf8'));
    assert.equal(saved.events.length, 2, 'o fechamento foi salvo no arquivo');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a conversa é salva a cada evento, não só no fim do turno', async () => {
  let release = () => {};
  const app = await setup(async function* () {
    yield init;
    yield say('trabalhando');
    await new Promise<void>((r) => (release = r));
    yield result;
  });
  try {
    const { body: chat } = await app.api('/api/chats', { body: {} });
    const seen = app.stream(chat.id as string, (e) => e.type === 'text');
    await app.api(`/api/chats/${chat.id}/messages`, { body: { text: 'oi' } });
    await seen;
    const onDisk = JSON.parse(readFileSync(join(app.root, 'data/chats', `${chat.id}.json`), 'utf8'));
    assert.deepEqual(onDisk.events.map((e: { type: string }) => e.type), ['user', 'session', 'text']);
    release();
  } finally {
    app.close();
  }
});
