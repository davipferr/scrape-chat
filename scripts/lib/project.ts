import { resolve } from 'node:path';
import { diskProbe, error, type FileProbe, type Issue } from './files.ts';
import { MANIFEST_FILE, parseManifest, type Manifest } from './skills.ts';

export interface Project {
  root: string;
  probe: FileProbe;
  manifest: Manifest | null;
  /** Problemas ao ler skills.json. */
  issues: Issue[];
}

/** Lê skills.json da raiz do projeto (ou de `--root`). */
export function loadProject(root = process.cwd()): Project {
  const abs = resolve(root);
  const probe = diskProbe(abs);
  const text = probe.read(MANIFEST_FILE);
  if (text === null) return { root: abs, probe, manifest: null, issues: [error(MANIFEST_FILE, `não encontrado em ${abs}`)] };
  const { manifest, issues } = parseManifest(text);
  return { root: abs, probe, manifest, issues };
}

const color = (code: number) => (text: string) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
export const red = color(31);
export const yellow = color(33);
export const green = color(32);
export const dim = color(2);
export const bold = color(1);

export function printIssues(issues: Issue[]): void {
  for (const issue of issues) {
    const tag = issue.level === 'error' ? red('erro ') : yellow('aviso');
    console.log(`  ${tag} ${dim(issue.where)}\n        ${issue.message}`);
  }
}
