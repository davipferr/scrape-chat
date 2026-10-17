import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { decide, decideBash, splitCommands } from '../src/server/policy.ts';

const root = resolve('/projeto');
const kind = (command: string) => decideBash(command).kind;

test('splitCommands respeita aspas e operadores', () => {
  assert.deepEqual(splitCommands(`npx just-scrape extract "https://a.com/?x=1&y=2" -p 'nome; preço' --json > data/jobs/j/raw/a.json && jq . f`), [
    ['npx', 'just-scrape', 'extract', 'https://a.com/?x=1&y=2', '-p', 'nome; preço', '--json', '>', 'data/jobs/j/raw/a.json'],
    ['jq', '.', 'f'],
  ]);
  assert.deepEqual(splitCommands('a | b; c\nd 2>&1'), [['a'], ['b'], ['c'], ['d', '2>&1']]);
  assert.equal(splitCommands('echo "aberto'), null);
});

test('motores e scripts do projeto rodam sem perguntar', () => {
  assert.equal(kind(`npx just-scrape extract "https://a.com" -p "x" --schema '{"type":"object"}' --json > data/jobs/2026-10-17-1530-a/raw/1.json`), 'allow');
  assert.equal(kind('npx browse open "https://a.com" --local && npx browse snapshot'), 'allow');
  assert.equal(kind('npm run --silent job -- new "precos"'), 'allow');
  assert.equal(kind('head -c 5000 data/jobs/x/raw/1.json | jq ".items | length"'), 'allow');
  assert.equal(kind('npx just-scrape crawl "https://a.com/docs" --max-pages 20 --json'), 'allow');
  assert.equal(kind('npx just-scrape credits --json 2>/dev/null'), 'allow');
});

test('o que gasta muito ou usa o login pede aprovação', () => {
  assert.equal(kind('npx just-scrape monitor create --url "https://a.com" --interval 1d'), 'ask');
  assert.equal(kind('npx just-scrape crawl "https://a.com"'), 'ask');
  assert.equal(kind('npx just-scrape crawl "https://a.com" --max-pages 200'), 'ask');
  assert.equal(kind('npx browse open "https://a.com" --auto-connect'), 'ask');
  assert.equal(kind('npx just-scrape monitor list'), 'allow');
});

test('contornar bloqueio, instalar global e sair da pasta é negado', () => {
  assert.equal(kind('npx just-scrape scrape "https://a.com" --stealth'), 'deny');
  assert.equal(kind('npx browse open "https://a.com" --remote'), 'deny');
  assert.equal(kind('npm install -g just-scrape@latest'), 'deny');
  assert.equal(kind('curl https://a.com'), 'deny');
  assert.equal(kind('cat .env'), 'deny');
  assert.equal(kind('cat ../outro/segredo.txt'), 'deny');
  assert.equal(kind('npx just-scrape scrape "https://a.com" > /tmp/x.json'), 'deny');
  assert.equal(kind('echo $(cat .env)'), 'deny');
  assert.equal(kind('npx browse open "https://a.com" && rm -rf data'), 'deny');
});

test('arquivos: lê o projeto (menos .env), grava só em data/jobs', () => {
  assert.equal(decide('Read', { file_path: 'skills/scrape-task/SKILL.md' }, root).kind, 'allow');
  assert.equal(decide('Read', { file_path: resolve(root, '.env') }, root).kind, 'deny');
  assert.equal(decide('Read', { file_path: '.env.example' }, root).kind, 'allow');
  assert.equal(decide('Read', { file_path: resolve('/etc/passwd') }, root).kind, 'deny');
  assert.equal(decide('Write', { file_path: resolve(root, 'data/jobs/x/job.json') }, root).kind, 'allow');
  assert.equal(decide('Write', { file_path: 'data/jobs/../../src/server/policy.ts' }, root).kind, 'deny');
  assert.equal(decide('Edit', { file_path: resolve(root, 'skills.json') }, root).kind, 'deny');
  assert.equal(decide('Task', {}, root).kind, 'deny');
});
