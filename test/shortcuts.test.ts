import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JobSummary } from '../src/jobs/store.ts';
import { SHORTCUTS, compose, followUps } from '../web/src/shortcuts.ts';

const shortcut = (id: string) => SHORTCUTS.find((s) => s.id === id)!;

test('atalho de link usa a URL do campo e o resto vira instrução extra', () => {
  const r = compose(shortcut('list'), 'https://loja.example/notebooks?page=1, só os acima de R$ 3000');
  assert.deepEqual(r, {
    ok: true,
    message: 'Extraia todos os itens listados em https://loja.example/notebooks?page=1, um por linha, com os campos que fizerem sentido para esse tipo de página. Além disso: só os acima de R$ 3000',
  });
});

test('vários links viram uma lista; sem link pede para colar', () => {
  const r = compose(shortcut('markdown'), 'https://a.com/x https://b.com/y.');
  assert.ok(r.ok && r.message.includes('https://a.com/x e https://b.com/y em Markdown'));
  assert.deepEqual(compose(shortcut('monitor'), 'qualquer coisa'), { ok: false, reason: 'Cole um link no campo e clique de novo.' });
});

test('busca usa o texto inteiro e não aceita campo vazio', () => {
  const r = compose(shortcut('search'), ' notebooks até 3000 reais ');
  assert.ok(r.ok && r.message.startsWith('Busque na web: notebooks até 3000 reais.'));
  assert.equal(compose(shortcut('search'), '  ').ok, false);
});

const job = (patch: Partial<JobSummary>): JobSummary => ({ id: 'j1', goal: 'preços', engine: 'just-scrape', operation: 'extract', shape: 'table', status: 'done', items: 3, source: null, createdAt: null, ...patch });

test('próximos passos dependem do job', () => {
  assert.deepEqual(followUps(job({}), 'https://a.com').map((f) => f.id), ['again', 'pages', 'monitor']);
  assert.deepEqual(followUps(job({ operation: 'crawl', shape: 'documents' }), null).map((f) => f.id), ['again']);
  assert.deepEqual(followUps(job({ status: 'blocked' }), 'https://a.com').map((f) => f.label), ['Tentar de outro jeito']);
  assert.deepEqual(followUps(job({ status: 'running' }), null), []);
  assert.deepEqual(followUps(job({ status: 'stopped' }), 'https://a.com').map((f) => f.label), ['Tentar de novo']);
});
