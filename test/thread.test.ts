import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatEvent } from '../src/server/events.ts';
import type { JobSummary } from '../src/jobs/store.ts';
import { buildThread } from '../web/src/thread.ts';

let seq = 0;
const ev = (body: Record<string, unknown>) => ({ ...body, seq: ++seq, at: '' }) as unknown as ChatEvent;
const job = (status: JobSummary['status'], items: number): JobSummary => ({ id: 'j1', goal: 'g', engine: 'just-scrape', operation: 'extract', shape: 'table', status, items, source: null, createdAt: null });

test('agrupa ferramentas, troca o cartão do job e fecha o turno', () => {
  const events = [
    ev({ type: 'user', text: 'oi' }),
    ev({ type: 'session', model: 'm' }),
    ev({ type: 'tool', toolUseId: 'a', name: 'Bash', summary: 'x' }),
    ev({ type: 'tool', toolUseId: 'b', name: 'Bash', summary: 'y' }),
    ev({ type: 'tool-result', toolUseId: 'a', ok: true }),
    ev({ type: 'job', job: job('running', 0) }),
    ev({ type: 'job', job: job('done', 6) }),
    ev({ type: 'approval', approvalId: 'p', tool: 'Bash', summary: 'm', reason: 'r' }),
    ev({ type: 'text', blockId: 't', text: 'pronto' }),
  ];
  const live = buildThread(events, 'rascunho');
  assert.equal(live.running, true);
  assert.equal(live.draft, 'rascunho');
  assert.deepEqual(live.items.map((i) => i.kind), ['user', 'tools', 'job', 'approval', 'text']);
  const tools = live.items[1]!;
  assert.deepEqual(tools.kind === 'tools' && tools.steps.map((s) => s.state), ['ok', 'running']);
  const card = live.items[2]!;
  assert.equal(card.kind === 'job' && card.job.status, 'done');

  const done = buildThread([...events, ev({ type: 'done', ok: true, costUsd: 0, durationMs: 1 })], 'resto');
  assert.equal(done.running, false);
  assert.equal(done.draft, '');
  const approval = done.items.find((i) => i.kind === 'approval');
  assert.equal(approval?.kind === 'approval' && approval.state, 'denied');
});
