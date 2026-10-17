import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWhen, humanInterval } from '../web/src/format.ts';

test('intervalos curtos viram frase; cron fica como está', () => {
  assert.equal(humanInterval('1d'), 'todo dia');
  assert.equal(humanInterval('3d'), 'a cada 3 dias');
  assert.equal(humanInterval('1h'), 'toda hora');
  assert.equal(humanInterval('30m'), 'a cada 30 min');
  assert.equal(humanInterval('0 9 * * 1'), 'agenda 0 9 * * 1');
});

test('datas relativas a hoje', () => {
  const now = new Date(2026, 9, 17, 18, 0);
  assert.match(formatWhen(new Date(2026, 9, 17, 14, 2).toISOString(), now), /^hoje às 14:02$/);
  assert.match(formatWhen(new Date(2026, 9, 16, 9, 10).toISOString(), now), /^ontem às 09:10$/);
  assert.match(formatWhen(new Date(2026, 9, 12, 18, 0).toISOString(), now), /^12\/10 às 18:00$/);
  assert.equal(formatWhen(null, now), '');
});
