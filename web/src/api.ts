// Cliente da API do servidor (src/server/app.ts). Os tipos vêm do próprio servidor.

import type { ChatEvent } from '../../src/server/events.ts';
import type { Chat, ChatSummary } from '../../src/server/chats.ts';
import type { JobDetail, JobSummary } from '../../src/jobs/store.ts';
import type { SavedShortcut } from '../../src/server/saved.ts';
import type { DiffLine, MonitorView, TickView } from '../../src/server/monitors.ts';

export type { ChatEvent, Chat, ChatSummary, JobDetail, JobSummary, SavedShortcut, DiffLine, MonitorView, TickView };

/** Um job do histórico: o resumo e a conversa de onde ele saiu. */
export type HistoryJob = JobSummary & { chatId: string | null };
export type MonitorItem = MonitorView & { jobId: string | null };
export interface MonitorList {
  available: boolean;
  reason?: string;
  monitors: MonitorItem[];
}

export interface Health {
  ok: boolean;
  fakeAgent: boolean;
  model: string;
  keys: { scrapegraph: boolean; anthropic: boolean };
}

async function call<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `erro ${res.status} em ${path}`);
  return data;
}

export const api = {
  health: () => call<Health>('/api/health'),
  chats: () => call<ChatSummary[]>('/api/chats'),
  chat: (id: string) => call<Chat & { running: boolean }>(`/api/chats/${id}`),
  createChat: () => call<Chat>('/api/chats', {}),
  send: (id: string, text: string) => call<{ accepted: boolean }>(`/api/chats/${id}/messages`, { text }),
  approve: (id: string, approvalId: string, allow: boolean) => call<{ ok: boolean }>(`/api/chats/${id}/approvals/${approvalId}`, { allow }),
  stop: (id: string) => call<{ stopped: boolean }>(`/api/chats/${id}/stop`, {}),
  jobs: () => call<HistoryJob[]>('/api/jobs'),
  job: (id: string) => call<JobDetail>(`/api/jobs/${id}`),
  monitors: () => call<MonitorList>('/api/monitors'),
  monitorActivity: (id: string) => call<TickView[]>(`/api/monitors/${id}/activity`),
  pauseMonitor: (id: string) => call<MonitorView>(`/api/monitors/${id}/pause`, {}),
  resumeMonitor: (id: string) => call<MonitorView>(`/api/monitors/${id}/resume`, {}),
  deleteMonitor: (id: string) => call<{ ok: boolean }>(`/api/monitors/${id}`, undefined, 'DELETE'),
  shortcuts: () => call<SavedShortcut[]>('/api/shortcuts'),
  saveShortcut: (label: string, text: string) => call<SavedShortcut>('/api/shortcuts', { label, text }),
  deleteShortcut: (id: string) => call<{ ok: boolean }>(`/api/shortcuts/${id}`, undefined, 'DELETE'),
};

/** Abre o SSE do chat a partir de `after`. O EventSource reconecta sozinho com Last-Event-ID. */
export function openStream(chatId: string, after: number, onEvent: (event: ChatEvent) => void): () => void {
  const source = new EventSource(`/api/chats/${chatId}/stream?after=${after}`);
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as ChatEvent);
  return () => source.close();
}
