import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FileProbe } from '../scripts/lib/files.ts';
import { installCommands, parseManifest, type Manifest } from '../scripts/lib/skills.ts';
import { validateProject } from '../scripts/lib/validate.ts';

const memory = (files: Record<string, string>): FileProbe => ({
  read: (path) => files[path] ?? null,
  mtimeMs: (path) => (path in files ? 0 : null),
});

const manifest: Manifest = {
  agents: ['claude-code'],
  external: [{ source: 'scrapegraphai/just-scrape', skills: ['just-scrape'], role: 'runtime' }],
};

test('parseManifest aceita o skills.json do projeto', () => {
  const { manifest: parsed, issues } = parseManifest(JSON.stringify(manifest));
  assert.deepEqual(issues, []);
  assert.deepEqual(parsed, manifest);
});

test('parseManifest exige role runtime ou dev', () => {
  const { manifest: parsed, issues } = parseManifest(
    JSON.stringify({ agents: ['claude-code'], external: [{ source: 'a/b', skills: ['x'] }] }),
  );
  assert.equal(parsed, null);
  assert.match(issues[0]?.message ?? '', /role/);
});

test('installCommands gera um add por fonte e um para as locais', () => {
  const commands = installCommands(manifest, ['scrape-task']);
  assert.deepEqual(
    commands.map((c) => c.args.slice(2, 6)),
    [
      ['add', 'scrapegraphai/just-scrape', '--skill', 'just-scrape'],
      ['add', './', '--skill', 'scrape-task'],
    ],
  );
});

test('validateProject aponta skill externa não instalada', () => {
  const issues = validateProject(manifest, [], memory({}));
  assert.equal(issues.length, 1);
  assert.match(issues[0]?.message ?? '', /npm run setup/);
});

test('validateProject avisa quando a cópia local instalada ficou para trás', () => {
  const skill = '---\nname: scrape-task\ndescription: faz scraping\n---\ncorpo\n';
  const issues = validateProject({ ...manifest, external: [] }, ['scrape-task'], memory({
    'skills/scrape-task/SKILL.md': skill,
    '.claude/skills/scrape-task/SKILL.md': skill.replace('corpo', 'antigo'),
  }));
  assert.deepEqual(issues.map((i) => i.level), ['warning']);
});
