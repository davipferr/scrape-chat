import type { JobSummary } from './api.ts';

export const STATUS_LABEL: Record<JobSummary['status'], string> = {
  running: 'Rodando',
  stopped: 'Interrompido',
  done: 'Pronto',
  partial: 'Parcial',
  blocked: 'Bloqueado',
  failed: 'Falhou',
  invalid: 'Fora do formato',
};

export const formatCount = (n: number) => n.toLocaleString('pt-BR');

/** Valor de uma célula da tabela: números no formato brasileiro, vazios visíveis. */
export function formatCell(value: unknown): { text: string; numeric: boolean; empty: boolean; url: boolean } {
  if (value === null || value === undefined || value === '') return { text: '—', numeric: false, empty: true, url: false };
  if (typeof value === 'number') return { text: value.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), numeric: true, empty: false, url: false };
  if (typeof value === 'boolean') return { text: value ? 'sim' : 'não', numeric: false, empty: false, url: false };
  if (typeof value === 'object') return { text: JSON.stringify(value), numeric: false, empty: false, url: false };
  const text = String(value);
  return { text, numeric: false, empty: false, url: /^https?:\/\//.test(text) };
}

/** "1d" vira "todo dia"; expressão cron fica como está. */
export function humanInterval(interval: string): string {
  const m = /^(\d+)\s*(m|min|h|d)$/i.exec(interval.trim());
  if (!m) return `agenda ${interval}`;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (unit === 'd') return n === 1 ? 'todo dia' : `a cada ${n} dias`;
  if (unit === 'h') return n === 1 ? 'toda hora' : `a cada ${n} horas`;
  return `a cada ${n} min`;
}

/** "hoje às 14:02", "ontem às 09:10" ou "12/10 às 18:00". */
export function formatWhen(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `hoje às ${time}`;
  if (diff === 1) return `ontem às ${time}`;
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return `${date} às ${time}`;
}

export const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
