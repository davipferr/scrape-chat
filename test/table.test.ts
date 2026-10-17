import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkJob, rowSchema, type Job } from '../src/jobs/contract.ts';
import { fieldName, fieldsToSchema, filterRows, schemaToFields, sortRows, toCsv, toJson } from '../web/src/table.ts';

const rows = [
  { nome: 'Notebook Ação', preco: 3299.9, url: 'https://a/1' },
  { nome: 'Ultrafino', preco: null, url: 'https://a/2' },
  { nome: 'notebook gamer', preco: 7499, url: 'https://a/3' },
];

test('busca ignora acento e caixa e exige todas as palavras', () => {
  assert.deepEqual(filterRows(rows, ['nome'], 'NOTEBOOK acao').map((r) => r.preco), [3299.9]);
  assert.equal(filterRows(rows, ['nome'], '  ').length, 3);
  assert.equal(filterRows(rows, ['nome'], 'a/2').length, 0, 'só procura nas colunas visíveis');
});

test('ordena números e textos, vazios sempre no fim', () => {
  assert.deepEqual(sortRows(rows, 'preco', 'desc').map((r) => r.preco), [7499, 3299.9, null]);
  assert.deepEqual(sortRows(rows, 'preco', 'asc').map((r) => r.preco), [3299.9, 7499, null]);
  assert.deepEqual(sortRows(rows, 'nome', 'asc').map((r) => r.nome), ['Notebook Ação', 'notebook gamer', 'Ultrafino']);
});

test('CSV escapa, neutraliza fórmulas e tem sabor Excel', () => {
  const tricky = [{ a: 'x, "y"', b: '=HYPERLINK("http://mal")', c: 1.5 }];
  assert.equal(toCsv(['a', 'b', 'c'], tricky), '﻿a,b,c\r\n"x, ""y""","\'=HYPERLINK(""http://mal"")",1.5\r\n');
  assert.equal(toCsv(['a', 'c'], [{ a: 'x, y', c: 1.5 }], 'excel'), '﻿a;c\r\nx, y;1,5\r\n');
});

test('JSON exporta só as colunas pedidas, com null nos vazios', () => {
  assert.deepEqual(JSON.parse(toJson(['nome', 'extra'], [rows[1]!])), [{ nome: 'Ultrafino', extra: null }]);
});

test('schema ida e volta pelo editor de campos', () => {
  const doc = readFileSync('skills/scrape-task/references/contrato-dos-jobs.md', 'utf8');
  const job = JSON.parse([...doc.matchAll(/```json\n([\s\S]*?)```/g)][0]![1]!) as Job;
  const fields = schemaToFields(job.schema);
  assert.deepEqual(fields.map((f) => [f.name, f.type, f.required]), [
    ['nome', 'texto', true],
    ['preco', 'número', true],
    ['url', 'texto', true],
  ]);
  const edited = fieldsToSchema([...fields, { name: 'Avaliação média', type: 'número', description: 'de 0 a 5', required: false }]);
  const { issues } = checkJob({ ...job, schema: edited }, 'job.json');
  assert.deepEqual(issues, []);
  const row = rowSchema(edited)!;
  assert.deepEqual((row.properties as Record<string, unknown>).avaliacao_media, { type: ['number', 'null'], description: 'de 0 a 5' });
  assert.deepEqual(row.required, ['nome', 'preco', 'url']);
  assert.equal(fieldName(' Preço (R$) '), 'preco_r');
});
