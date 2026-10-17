import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { FileProbe } from '../scripts/lib/files.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkJob, checkJobDir, checkResult, createJobDir, newJobId, type Job, type ScrapeResult } from '../src/jobs/contract.ts';

const memory = (files: Record<string, string>): FileProbe => ({
  read: (path) => files[path] ?? null,
  mtimeMs: (path) => (path in files ? 0 : null),
});

// Os exemplos do contrato são a fixture: se a doc sair do formato, o teste quebra.
const doc = readFileSync('skills/scrape-task/references/contrato-dos-jobs.md', 'utf8');
const [jobExample, resultExample] = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] ?? ''));
const job = jobExample as Job;
const result = resultExample as ScrapeResult;
const dir = `data/jobs/${job.id}`;

const messages = (issues: { message: string }[]) => issues.map((i) => i.message).join(' | ');

test('os exemplos do contrato passam no check', () => {
  const issues = checkJobDir(memory({ [`${dir}/job.json`]: JSON.stringify(job), [`${dir}/result.json`]: JSON.stringify(result) }), job.id);
  assert.deepEqual(issues, []);
});

test('job sem result.json confere só o plano', () => {
  assert.deepEqual(checkJobDir(memory({ [`${dir}/job.json`]: JSON.stringify(job) }), job.id), []);
});

test('id do job precisa bater com a pasta', () => {
  const issues = checkJobDir(memory({ [`data/jobs/outra/job.json`]: JSON.stringify(job) }), 'outra');
  assert.match(messages(issues), /nome da pasta/);
});

test('browser só faz browse, e alvos precisam ser URL', () => {
  const { issues } = checkJob({ ...job, engine: 'browser', targets: ['loja.example'] }, 'job.json');
  assert.match(messages(issues), /só faz a operação `browse`/);
  assert.match(messages(issues), /não é uma URL/);
});

test('search aceita uma frase como alvo', () => {
  const { issues } = checkJob({ ...job, operation: 'search', targets: ['notebooks até 3000 reais'] }, 'job.json');
  assert.deepEqual(issues, []);
});

test('tabela exige schema com items array', () => {
  const { issues } = checkJob({ ...job, schema: { type: 'object', properties: { nome: { type: 'string' } } } }, 'job.json');
  assert.match(messages(issues), /properties.items/);
});

test('linhas fora do schema e colunas faltando são erro', () => {
  const issues = checkResult({ ...result, columns: ['nome'], rows: [{ nome: 'A', preco: 'caro', url: 'x' }] }, job, 'result.json');
  assert.match(messages(issues), /faltam em `columns`: preco, url/);
  assert.match(messages(issues), /fora do schema/);
});

test('done com zero linhas é erro; blocked exige error', () => {
  assert.match(messages(checkResult({ ...result, rows: [] }, job, 'r')), /zero linhas/);
  assert.match(messages(checkResult({ ...result, status: 'blocked', error: null }, job, 'r')), /explicar o motivo/);
  assert.deepEqual(checkResult({ ...result, status: 'blocked', error: 'HTTP 403', rows: undefined }, job, 'r'), []);
});

test('segredo escrito num comando é erro, $VARIAVEL não', () => {
  const leaked = checkResult({ ...result, commands: ['curl -H "Authorization: Bearer abcdefghijklmnop1234"'] }, job, 'r');
  assert.match(messages(leaked), /segredo/);
  assert.deepEqual(checkResult({ ...result, commands: ['curl -H "Authorization: Bearer $API_TOKEN"'] }, job, 'r'), []);
});

test('documentos exigem documents', () => {
  const docsJob: Job = { ...job, operation: 'scrape', shape: 'documents', schema: null, prompt: null };
  assert.match(messages(checkResult({ ...result, jobId: docsJob.id }, docsJob, 'r')), /sem `documents`/);
  const ok = { ...result, columns: undefined, rows: undefined, documents: [{ url: 'https://loja.example', markdown: '# Oi' }] };
  assert.deepEqual(checkResult(ok, docsJob, 'r'), []);
});

test('newJobId usa data local e apelido sem acento', () => {
  assert.equal(newJobId('Preços de Notebooks!', new Date(2026, 9, 17, 9, 5)), '2026-10-17-0905-precos-de-notebooks');
  assert.equal(newJobId('???', new Date(2026, 0, 1, 0, 0)), '2026-01-01-0000-job');
});

test('job de monitor precisa registrar o monitor criado', () => {
  const monitorJob: Job = { ...job, operation: 'monitor', shape: 'documents', schema: null, prompt: null };
  const base = { ...result, columns: undefined, rows: undefined, documents: [{ url: 'https://loja.example', markdown: 'x' }] };
  assert.match(messages(checkResult(base, monitorJob, 'r')), /sem `monitor`/);
  assert.deepEqual(checkResult({ ...base, monitor: { id: 'cron-1', url: 'https://loja.example', interval: '1d' } }, monitorJob, 'r'), []);
});

test('createJobDir não sobrescreve um job do mesmo minuto', () => {
  const root = mkdtempSync(join(tmpdir(), 'jobs-'));
  try {
    const now = new Date(2026, 9, 17, 9, 5);
    assert.deepEqual(
      [createJobDir(root, 'preços', now), createJobDir(root, 'preços', now), createJobDir(root, 'preços', now)],
      ['2026-10-17-0905-precos', '2026-10-17-0905-precos-2', '2026-10-17-0905-precos-3'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
