import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { error, parseFrontmatter, type FileProbe, type Issue } from './files.ts';

export const LOCAL_SKILLS_DIR = 'skills';
export const MANIFEST_FILE = 'skills.json';
/** Pastas onde o CLI `skills` instala para cada agente (escopo de projeto). */
export const INSTALL_DIRS = ['.claude/skills', '.agents/skills'];
export const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface LocalSkill {
  dir: string;
  name: string | null;
  description: string | null;
  /** SKILL.md inteiro, para comparar com a cópia instalada. */
  text: string;
}

/** `runtime`: o agente do chat usa ao fazer scraping. `dev`: só para construir o projeto. */
export type SkillRole = 'runtime' | 'dev';

export interface ExternalSource {
  source: string;
  skills: string[];
  role: SkillRole;
}

export interface Manifest {
  agents: string[];
  external: ExternalSource[];
}

export function listLocalSkillDirs(root: string): string[] {
  try {
    return readdirSync(join(root, LOCAL_SKILLS_DIR), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function readLocalSkill(probe: FileProbe, dir: string): LocalSkill | null {
  const text = probe.read(`${LOCAL_SKILLS_DIR}/${dir}/SKILL.md`);
  if (text === null) return null;
  const fm = parseFrontmatter(text);
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return { dir, name: str(fm?.data.name), description: str(fm?.data.description), text };
}

/** Regras do padrão Agent Skills para o cabeçalho de um SKILL.md. */
export function checkSkill(skill: LocalSkill): Issue[] {
  const where = `${LOCAL_SKILLS_DIR}/${skill.dir}/SKILL.md`;
  const issues: Issue[] = [];
  if (skill.name === null) issues.push(error(where, 'falta `name` no cabeçalho (frontmatter)'));
  else {
    if (skill.name !== skill.dir) issues.push(error(where, `\`name: ${skill.name}\` precisa ser igual ao nome da pasta (${skill.dir})`));
    if (!KEBAB.test(skill.name) || skill.name.length > 64) issues.push(error(where, '`name` deve ser minúsculo-com-hifens, até 64 caracteres'));
  }
  if (skill.description === null || skill.description.trim() === '') issues.push(error(where, 'falta `description` no cabeçalho'));
  else if (skill.description.length > 1024) issues.push(error(where, '`description` passa de 1024 caracteres'));
  return issues;
}

/** Conteúdo do SKILL.md instalado para algum agente, ou `null` se não instalado. */
export function readInstalled(probe: FileProbe, name: string): string | null {
  for (const dir of INSTALL_DIRS) {
    const text = probe.read(`${dir}/${name}/SKILL.md`);
    if (text !== null) return text;
  }
  return null;
}

/** Versão fixa do CLI `skills` (npm), para o setup ser reproduzível. */
export const SKILLS_CLI = 'skills@1.7.0';

export interface InstallCommand {
  label: string;
  args: string[];
}

/** Os comandos `npx skills add ...` que instalam tudo o que o projeto precisa. */
export function installCommands(manifest: Manifest, localSkills: string[]): InstallCommand[] {
  const common = ['--agent', ...manifest.agents, '--yes'];
  const commands = manifest.external.map((e) => ({
    label: `${e.role}: ${e.source}`,
    args: ['-y', SKILLS_CLI, 'add', e.source, '--skill', ...e.skills, ...common],
  }));
  if (localSkills.length > 0) {
    commands.push({ label: 'locais (pasta skills/)', args: ['-y', SKILLS_CLI, 'add', './', '--skill', ...localSkills, ...common] });
  }
  return commands;
}

export function parseManifest(text: string): { manifest: Manifest | null; issues: Issue[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { manifest: null, issues: [error(MANIFEST_FILE, `JSON inválido: ${(e as Error).message}`)] };
  }
  const doc = (raw ?? {}) as Record<string, unknown>;
  const issues: Issue[] = [];
  const agents = Array.isArray(doc.agents) ? doc.agents.filter((a): a is string => typeof a === 'string') : [];
  if (agents.length === 0) issues.push(error(MANIFEST_FILE, '`agents` precisa listar pelo menos um agente (ex.: "claude-code")'));
  const external: ExternalSource[] = [];
  if (!Array.isArray(doc.external)) issues.push(error(MANIFEST_FILE, '`external` precisa ser uma lista (use [] se vazia)'));
  else
    doc.external.forEach((e: unknown, i: number) => {
      const where = `${MANIFEST_FILE} › external[${i}]`;
      const entry = (e ?? {}) as Record<string, unknown>;
      const skills = Array.isArray(entry.skills) ? entry.skills.filter((s): s is string => typeof s === 'string') : [];
      if (typeof entry.source !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(entry.source)) {
        issues.push(error(where, '`source` precisa ser "owner/repo"'));
      } else if (skills.length === 0) {
        issues.push(error(where, '`skills` precisa listar quais skills instalar do repositório'));
      } else if (entry.role !== 'runtime' && entry.role !== 'dev') {
        issues.push(error(where, '`role` precisa ser "runtime" ou "dev"'));
      } else external.push({ source: entry.source, skills, role: entry.role });
    });
  return { manifest: issues.length ? null : { agents, external }, issues };
}
