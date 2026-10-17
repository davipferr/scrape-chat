// Lógica pura dos artefatos: filtrar, ordenar, exportar e editar o schema.
// Sem React aqui, para os testes rodarem no Node.

export type Row = Record<string, unknown>;
export type SortDir = 'asc' | 'desc';

const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Linhas em que algum campo visível contém todas as palavras da busca (sem acento, sem caixa). */
export function filterRows(rows: Row[], columns: string[], query: string): Row[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const haystack = fold(columns.map((c) => text(row[c])).join(' \u0000 '));
    return words.every((w) => haystack.includes(w));
  });
}

/** Ordena sem mexer no array original. Vazios vão sempre para o fim. */
export function sortRows(rows: Row[], column: string, dir: SortDir): Row[] {
  const sign = dir === 'asc' ? 1 : -1;
  const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
  return [...rows].sort((a, b) => {
    const x = a[column];
    const y = b[column];
    const xe = x === null || x === undefined || x === '';
    const ye = y === null || y === undefined || y === '';
    if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return collator.compare(text(x), text(y)) * sign;
  });
}

export type CsvFlavor = 'csv' | 'excel';

/**
 * CSV com BOM (para acentos abrirem certo). `excel` usa `;` e vírgula decimal,
 * como o Excel em português espera. Células que começam com = + - @ ganham um
 * apóstrofo: o conteúdo veio de sites de terceiros e não pode virar fórmula.
 */
export function toCsv(columns: string[], rows: Row[], flavor: CsvFlavor = 'csv'): string {
  const sep = flavor === 'excel' ? ';' : ',';
  const cell = (v: unknown): string => {
    let s: string;
    if (typeof v === 'number') s = flavor === 'excel' ? String(v).replace('.', ',') : String(v);
    else {
      s = text(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    }
    return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(cell).join(sep), ...rows.map((r) => columns.map((c) => cell(r[c])).join(sep))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function toJson(columns: string[], rows: Row[]): string {
  return JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))), null, 2);
}

// ---------- schema ----------

export const FIELD_TYPES = ['texto', 'número', 'inteiro', 'sim/não', 'link', 'lista'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface Field {
  name: string;
  type: FieldType;
  description: string;
  required: boolean;
}

type Json = Record<string, unknown>;

function baseType(prop: Json): FieldType {
  const types = ([] as unknown[]).concat(prop.type ?? 'string').filter((t) => t !== 'null');
  const t = types[0];
  if (t === 'number') return 'número';
  if (t === 'integer') return 'inteiro';
  if (t === 'boolean') return 'sim/não';
  if (t === 'array') return 'lista';
  if (prop.format === 'uri' || prop.format === 'url') return 'link';
  return 'texto';
}

/** Lê os campos de uma linha do schema do job (`properties.items.items`). */
export function schemaToFields(schema: Json | null): Field[] {
  const row = ((schema?.properties as Json | undefined)?.items as Json | undefined)?.items as Json | undefined;
  const props = (row?.properties ?? {}) as Record<string, Json>;
  const required = new Set((row?.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, prop]) => ({
    name,
    type: baseType(prop),
    description: typeof prop.description === 'string' ? prop.description : '',
    required: required.has(name),
  }));
}

/** Nome de campo no formato do contrato: snake_case, sem acento. */
export function fieldName(raw: string): string {
  return fold(raw)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Monta o schema de tabela do contrato. Campo não obrigatório aceita null. */
export function fieldsToSchema(fields: Field[]): Json {
  const properties: Record<string, Json> = {};
  for (const f of fields) {
    const name = fieldName(f.name);
    if (!name) continue;
    const prop: Json =
      f.type === 'número' ? { type: 'number' }
      : f.type === 'inteiro' ? { type: 'integer' }
      : f.type === 'sim/não' ? { type: 'boolean' }
      : f.type === 'lista' ? { type: 'array', items: { type: 'string' } }
      : f.type === 'link' ? { type: 'string', format: 'uri' }
      : { type: 'string' };
    if (!f.required) prop.type = [prop.type, 'null'];
    if (f.description.trim()) prop.description = f.description.trim();
    properties[name] = prop;
  }
  const required = fields.filter((f) => f.required && fieldName(f.name)).map((f) => fieldName(f.name));
  return {
    type: 'object',
    properties: { items: { type: 'array', items: { type: 'object', properties, required } } },
    required: ['items'],
  };
}
