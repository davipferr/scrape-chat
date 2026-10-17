import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/**
 * O pouco de sistema de arquivos que a lógica do pipeline precisa.
 * Os testes passam uma versão em memória; os scripts usam `diskProbe`.
 */
export interface FileProbe {
  /** Conteúdo do arquivo (caminho relativo à raiz do projeto) ou `null` se não existir. */
  read(path: string): string | null;
  /** Data de modificação em ms, ou `null` se não existir. */
  mtimeMs(path: string): number | null;
}

export function diskProbe(root: string): FileProbe {
  return {
    read(path) {
      try {
        return readFileSync(join(root, path), 'utf8');
      } catch {
        return null;
      }
    },
    mtimeMs(path) {
      try {
        return statSync(join(root, path)).mtimeMs;
      } catch {
        return null;
      }
    },
  };
}

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Separa o cabeçalho YAML (`---` ... `---`) do corpo de um Markdown. */
export function parseFrontmatter(text: string): Frontmatter | null {
  const match = FRONTMATTER.exec(text);
  if (!match) return null;
  const data: unknown = parse(match[1] ?? '');
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  return { data: data as Record<string, unknown>, body: text.slice(match[0].length) };
}

export interface Issue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

export const error = (where: string, message: string): Issue => ({ level: 'error', where, message });
export const warning = (where: string, message: string): Issue => ({ level: 'warning', where, message });
