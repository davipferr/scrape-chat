// Transforma a lista de eventos do chat no que a tela mostra. Função pura:
// os mesmos eventos sempre dão a mesma conversa, venham do arquivo ou do SSE.

import type { ChatEvent, JobSummary } from './api.ts';

export interface ToolStep {
  id: string;
  name: string;
  summary: string;
  state: 'running' | 'ok' | 'error';
}

export type ThreadItem =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'tools'; key: string; steps: ToolStep[] }
  | { kind: 'approval'; key: string; approvalId: string; summary: string; reason: string; state: 'pending' | 'allowed' | 'denied' }
  | { kind: 'job'; key: string; job: JobSummary }
  | { kind: 'done'; key: string; ok: boolean; costUsd: number; durationMs: number; error?: string };

export interface Thread {
  items: ThreadItem[];
  /** Texto chegando ao vivo, ainda sem a versão final. */
  draft: string;
  running: boolean;
  lastSeq: number;
}

export function buildThread(events: ChatEvent[], draft = ''): Thread {
  const items: ThreadItem[] = [];
  const steps = new Map<string, ToolStep>();
  const approvals = new Map<string, Extract<ThreadItem, { kind: 'approval' }>>();
  // Um job aparece uma vez por turno: as atualizações trocam o cartão em vez de repetir.
  let turnJobs = new Map<string, Extract<ThreadItem, { kind: 'job' }>>();
  let running = false;

  for (const e of events) {
    switch (e.type) {
      case 'user':
        items.push({ kind: 'user', key: `u${e.seq}`, text: e.text });
        turnJobs = new Map();
        running = true;
        break;
      case 'text':
        items.push({ kind: 'text', key: `t${e.seq}`, text: e.text });
        break;
      case 'tool': {
        const step: ToolStep = { id: e.toolUseId, name: e.name, summary: e.summary, state: 'running' };
        steps.set(e.toolUseId, step);
        const last = items.at(-1);
        if (last?.kind === 'tools') last.steps.push(step);
        else items.push({ kind: 'tools', key: `w${e.seq}`, steps: [step] });
        break;
      }
      case 'tool-result': {
        const step = steps.get(e.toolUseId);
        if (step) step.state = e.ok ? 'ok' : 'error';
        break;
      }
      case 'approval': {
        const item = { kind: 'approval' as const, key: `a${e.seq}`, approvalId: e.approvalId, summary: e.summary, reason: e.reason, state: 'pending' as const };
        approvals.set(e.approvalId, item);
        items.push(item);
        break;
      }
      case 'approval-resolved': {
        const item = approvals.get(e.approvalId);
        if (item) item.state = e.allowed ? 'allowed' : 'denied';
        break;
      }
      case 'job': {
        const existing = turnJobs.get(e.job.id);
        if (existing) existing.job = e.job;
        else {
          const item = { kind: 'job' as const, key: `j${e.seq}`, job: e.job };
          turnJobs.set(e.job.id, item);
          items.push(item);
        }
        break;
      }
      case 'done':
        for (const step of steps.values()) if (step.state === 'running') step.state = e.ok ? 'ok' : 'error';
        for (const a of approvals.values()) if (a.state === 'pending') a.state = 'denied';
        items.push({ kind: 'done', key: `d${e.seq}`, ok: e.ok, costUsd: e.costUsd, durationMs: e.durationMs, ...(e.error ? { error: e.error } : {}) });
        running = false;
        break;
      default:
        break;
    }
  }
  return { items, draft: running ? draft : '', running, lastSeq: events.at(-1)?.seq ?? 0 };
}
