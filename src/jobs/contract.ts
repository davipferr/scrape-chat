// O contrato de um job de scraping: o que a skill scrape-task grava em
// data/jobs/<id>/ e o que o servidor e a interface leem depois.
// Formato explicado para humanos em skills/scrape-task/references/contrato-dos-jobs.md.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv, type ErrorObject } from 'ajv';
import { error, warning, type FileProbe, type Issue } from '../../scripts/lib/files.ts';

export const JOBS_DIR = 'data/jobs';
export const JOB_FILE = 'job.json';
export const RESULT_FILE = 'result.json';
/** `2026-10-17-1530-precos-notebooks`: data, hora e um apelido curto. */
export const JOB_ID = /^\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9]+(-[a-z0-9]+)*$/;

export const ENGINES = ['just-scrape', 'browser'] as const;
export const OPERATIONS = ['search', 'scrape', 'extract', 'crawl', 'monitor', 'browse'] as const;
export const SHAPES = ['table', 'documents'] as const;
export const RESULT_STATUSES = ['done', 'partial', 'blocked', 'failed'] as const;

export type Engine = (typeof ENGINES)[number];
export type Operation = (typeof OPERATIONS)[number];
export type Shape = (typeof SHAPES)[number];
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export interface Job {
  version: 1;
  id: string;
  createdAt: string;
  /** O pedido do usuário, como ele escreveu. */
  request: string;
  /** Uma frase: o que este job entrega. */
  goal: string;
  engine: Engine;
  operation: Operation;
  /** URLs, ou a busca quando `operation` é `search`. */
  targets: string[];
  /** Instrução de extração passada ao motor (`-p`), ou null. */
  prompt: string | null;
  /** JSON Schema da saída. Para `table`: um objeto com `items: array`. */
  schema: Record<string, unknown> | null;
  shape: Shape;
  /** Flags do motor: mode, scrolls, maxPages, maxDepth, includePatterns, country, interval... */
  options: Record<string, unknown>;
  /** O que a skill decidiu sem perguntar, para o usuário poder corrigir. */
  assumptions: string[];
}

export interface ScrapedDocument {
  url: string;
  title?: string;
  markdown: string;
}

/** O monitor criado por um job `monitor` (o `cronId` da ScrapeGraph). */
export interface MonitorRef {
  id: string;
  url: string;
  interval: string;
}

export interface ScrapeResult {
  version: 1;
  jobId: string;
  status: ResultStatus;
  finishedAt: string;
  /** Comandos exatamente como rodaram, com segredos só como $VARIAVEL. */
  commands: string[];
  /** Para `table`: nomes das colunas, na ordem de exibição. */
  columns?: string[];
  rows?: Record<string, unknown>[];
  documents?: ScrapedDocument[];
  /** Obrigatório em jobs `monitor` que deram certo. */
  monitor?: MonitorRef;
  /** URLs de onde os dados vieram de fato. */
  sources: string[];
  warnings: string[];
  /** Obrigatório quando `status` é `blocked` ou `failed`. */
  error: string | null;
}

const jobSchema = {
  type: 'object',
  required: ['version', 'id', 'createdAt', 'request', 'goal', 'engine', 'operation', 'targets', 'prompt', 'schema', 'shape', 'options', 'assumptions'],
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    id: { type: 'string', pattern: JOB_ID.source },
    createdAt: { type: 'string', minLength: 1 },
    request: { type: 'string', minLength: 1 },
    goal: { type: 'string', minLength: 1 },
    engine: { enum: ENGINES },
    operation: { enum: OPERATIONS },
    targets: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    prompt: { type: ['string', 'null'] },
    schema: { type: ['object', 'null'] },
    shape: { enum: SHAPES },
    options: { type: 'object' },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
};

const resultSchema = {
  type: 'object',
  required: ['version', 'jobId', 'status', 'finishedAt', 'commands', 'sources', 'warnings', 'error'],
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    jobId: { type: 'string' },
    status: { enum: RESULT_STATUSES },
    finishedAt: { type: 'string', minLength: 1 },
    commands: { type: 'array', items: { type: 'string' } },
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'object' } },
    documents: {
      type: 'array',
      items: {
        type: 'object',
        required: ['url', 'markdown'],
        properties: { url: { type: 'string' }, title: { type: 'string' }, markdown: { type: 'string' } },
      },
    },
    monitor: {
      type: 'object',
      required: ['id', 'url', 'interval'],
      additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1 }, url: { type: 'string' }, interval: { type: 'string' } },
    },
    sources: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    error: { type: ['string', 'null'] },
  },
};

// Schemas escritos pelo agente podem ter `format` e palavras extras: não falhar por isso.
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validateJobShape = ajv.compile<Job>(jobSchema);
const validateResultShape = ajv.compile<ScrapeResult>(resultSchema);

/** Padrões de segredo que nunca devem aparecer escritos nos comandos salvos. */
const SECRET = /(sgai-[A-Za-z0-9]{8,}|bb_live_[A-Za-z0-9]{8,}|sk-ant-[A-Za-z0-9-]{8,}|Bearer\s+(?!\$)[A-Za-z0-9._-]{16,})/;

const describe = (errors: ErrorObject[] | null | undefined) =>
  (errors ?? []).slice(0, 5).map((e) => `${e.instancePath || '(raiz)'} ${e.message ?? ''}`.trim());

function readJson(probe: FileProbe, path: string, issues: Issue[]): unknown {
  const text = probe.read(path);
  if (text === null) {
    issues.push(error(path, 'arquivo não encontrado'));
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    issues.push(error(path, `JSON inválido: ${(e as Error).message}`));
    return undefined;
  }
}

/** Confere job.json sozinho (o plano, antes de rodar qualquer coisa). */
export function checkJob(raw: unknown, where: string, folder?: string): { job: Job | null; issues: Issue[] } {
  if (!validateJobShape(raw)) return { job: null, issues: describe(validateJobShape.errors).map((m) => error(where, m)) };
  const job = raw;
  const issues: Issue[] = [];
  if (folder !== undefined && job.id !== folder) issues.push(error(where, `\`id\` (${job.id}) precisa ser igual ao nome da pasta (${folder})`));
  if (job.engine === 'browser' && job.operation !== 'browse') issues.push(error(where, 'o motor `browser` só faz a operação `browse`'));
  if (job.engine === 'just-scrape' && job.operation === 'browse') issues.push(error(where, '`browse` é do motor `browser`, não do `just-scrape`'));
  if (job.operation !== 'search') {
    for (const t of job.targets) if (!/^https?:\/\//.test(t)) issues.push(error(where, `alvo não é uma URL http(s): ${t}`));
  }
  if (job.schema !== null) {
    try {
      ajv.compile(job.schema);
    } catch (e) {
      issues.push(error(where, `\`schema\` não é um JSON Schema válido: ${(e as Error).message}`));
    }
    if (job.shape === 'table' && rowSchema(job.schema) === null) {
      issues.push(error(where, 'para `shape: table`, o `schema` precisa ter `properties.items` do tipo array (as linhas)'));
    }
  } else if (job.shape === 'table' && (job.operation === 'extract' || job.operation === 'search')) {
    issues.push(warning(where, 'tabela sem `schema`: as colunas podem variar de linha para linha'));
  }
  return { job, issues };
}

/** O schema de uma linha da tabela: `schema.properties.items.items`. */
export function rowSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  const items = (schema.properties as Record<string, unknown> | undefined)?.items as Record<string, unknown> | undefined;
  if (!items || items.type !== 'array') return null;
  return (items.items as Record<string, unknown> | undefined) ?? {};
}

/** Confere result.json contra o job que o gerou. */
export function checkResult(raw: unknown, job: Job, where: string): Issue[] {
  if (!validateResultShape(raw)) return describe(validateResultShape.errors).map((m) => error(where, m));
  const result = raw;
  const issues: Issue[] = [];
  if (result.jobId !== job.id) issues.push(error(where, `\`jobId\` (${result.jobId}) não bate com o job (${job.id})`));
  for (const c of result.commands) if (SECRET.test(c)) issues.push(error(where, `segredo escrito num comando; use $VARIAVEL: ${c.slice(0, 60)}…`));

  if (result.status === 'blocked' || result.status === 'failed') {
    if (!result.error) issues.push(error(where, `\`status: ${result.status}\` precisa explicar o motivo em \`error\``));
    return issues;
  }

  if (job.operation === 'monitor' && !result.monitor) issues.push(error(where, 'job de monitor sem `monitor` (id, url, interval): sem o id não dá para pausar nem ver as mudanças'));

  if (job.shape === 'table') {
    const rows = result.rows;
    if (!rows) return [...issues, error(where, 'job de tabela sem `rows`')];
    if (result.status === 'done' && rows.length === 0) issues.push(error(where, '`status: done` com zero linhas: use `partial` ou `failed` e explique'));
    if (!result.columns || result.columns.length === 0) issues.push(error(where, 'job de tabela sem `columns`'));
    else {
      const extra = new Set(rows.flatMap((r) => Object.keys(r)).filter((k) => !result.columns!.includes(k)));
      if (extra.size) issues.push(error(where, `campos nas linhas que faltam em \`columns\`: ${[...extra].join(', ')}`));
    }
    const schema = job.schema && rowSchema(job.schema);
    if (schema) {
      const validateRow = ajv.compile(schema);
      const bad = rows.flatMap((row, i) => (validateRow(row) ? [] : describe(validateRow.errors).map((m) => `linha ${i}: ${m}`)));
      if (bad.length) issues.push(error(where, `linhas fora do schema do job (${bad.length}): ${bad.slice(0, 3).join('; ')}`));
    }
  } else {
    if (!result.documents) issues.push(error(where, 'job de documentos sem `documents`'));
    else if (result.status === 'done' && result.documents.length === 0) issues.push(error(where, '`status: done` sem nenhum documento'));
  }

  if (result.sources.length === 0) issues.push(warning(where, '`sources` vazio: de onde vieram os dados?'));
  return issues;
}

/** Confere uma pasta data/jobs/<id>/ inteira. Sem result.json, confere só o plano. */
export function checkJobDir(probe: FileProbe, id: string): Issue[] {
  const dir = `${JOBS_DIR}/${id}`;
  const issues: Issue[] = [];
  const raw = readJson(probe, `${dir}/${JOB_FILE}`, issues);
  if (raw === undefined) return issues;
  const { job, issues: jobIssues } = checkJob(raw, `${dir}/${JOB_FILE}`, id);
  issues.push(...jobIssues);
  if (!job || probe.read(`${dir}/${RESULT_FILE}`) === null) return issues;
  const result = readJson(probe, `${dir}/${RESULT_FILE}`, issues);
  if (result !== undefined) issues.push(...checkResult(result, job, `${dir}/${RESULT_FILE}`));
  return issues;
}

/**
 * Cria a pasta de um job novo (com `raw/`) e devolve o id. Se já existe um job
 * com o mesmo apelido no mesmo minuto, acrescenta -2, -3... em vez de sobrescrever.
 */
export function createJobDir(root: string, slug: string, now = new Date()): string {
  const base = newJobId(slug, now);
  let id = base;
  for (let n = 2; existsSync(join(root, JOBS_DIR, id)); n++) id = `${base}-${n}`;
  mkdirSync(join(root, JOBS_DIR, id, 'raw'), { recursive: true });
  return id;
}

/** Id de um job novo: data e hora locais + apelido em kebab-case. */
export function newJobId(slug: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const clean = slug
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${date}-${clean || 'job'}`;
}
