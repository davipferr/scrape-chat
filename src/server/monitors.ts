// Monitores de mudança. Eles vivem na ScrapeGraph AI (o agente cria com
// `just-scrape monitor create`); aqui o servidor lista, pausa, retoma, apaga e
// mostra o que mudou, direto pelo SDK, sem passar pelo agente: são cliques do
// próprio usuário na tela de Monitores.

import { monitor, type MonitorResponse, type MonitorTickEntry } from 'scrapegraph-js';

export interface MonitorView {
  id: string;
  name: string | null;
  url: string;
  interval: string;
  status: 'active' | 'paused';
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DiffLine {
  type: 'added' | 'removed';
  content: string;
}

export interface TickView {
  id: string;
  status: 'completed' | 'failed' | 'running' | 'paused';
  createdAt: string;
  changed: boolean;
  added: number;
  removed: number;
  /** Primeiras linhas da diferença em Markdown, para mostrar sem baixar nada. */
  lines: DiffLine[];
}

/** O que o servidor precisa de um provedor de monitores. Os testes e o modo --fake trocam por outro. */
export interface MonitorClient {
  list(): Promise<MonitorView[]>;
  activity(id: string): Promise<TickView[]>;
  pause(id: string): Promise<MonitorView>;
  resume(id: string): Promise<MonitorView>;
  remove(id: string): Promise<void>;
}

export class MonitorsUnavailable extends Error {}

const MAX_LINES = 60;

export function toMonitorView(m: MonitorResponse): MonitorView {
  const raw = m as MonitorResponse & { createdAt?: string; updatedAt?: string };
  return {
    id: m.cronId,
    name: m.config.name ?? null,
    url: m.config.url,
    interval: m.interval,
    status: m.status,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}

export function toTickView(t: MonitorTickEntry): TickView {
  const markdown = (t.diffs as { markdown?: { type: 'added' | 'removed'; content: string }[] }).markdown ?? [];
  return {
    id: t.id,
    status: t.status,
    createdAt: t.createdAt,
    changed: t.changed,
    added: markdown.filter((l) => l.type === 'added').length,
    removed: markdown.filter((l) => l.type === 'removed').length,
    lines: markdown.slice(0, MAX_LINES).map((l) => ({ type: l.type, content: l.content })),
  };
}

/** Cliente de verdade, com a SGAI_API_KEY do .env. Sem a chave, tudo vira MonitorsUnavailable. */
export function createScrapeGraphMonitors(apiKey: string | undefined): MonitorClient {
  const key = () => {
    if (!apiKey) throw new MonitorsUnavailable('Preencha SGAI_API_KEY no .env e reinicie o servidor para ver os monitores.');
    return apiKey;
  };
  const unwrap = async <T>(call: Promise<{ status: 'success' | 'error'; data: T | null; error?: string }>): Promise<T> => {
    const result = await call;
    if (result.status !== 'success' || result.data === null) throw new Error(result.error ?? 'a ScrapeGraph AI não respondeu');
    return result.data;
  };
  return {
    list: async () => (await unwrap(monitor.list(key()))).map(toMonitorView),
    activity: async (id) => (await unwrap(monitor.activity(key(), id, { limit: 30 }))).ticks.map(toTickView),
    pause: async (id) => toMonitorView(await unwrap(monitor.pause(key(), id))),
    resume: async (id) => toMonitorView(await unwrap(monitor.resume(key(), id))),
    remove: async (id) => {
      await unwrap(monitor.delete(key(), id));
    },
  };
}

/** Monitores de mentira para o modo --fake: mostram a tela sem chave nem créditos. */
export function createFakeMonitors(): MonitorClient {
  const now = Date.now();
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();
  const monitors: MonitorView[] = [
    { id: 'fake-promocoes', name: 'Promoções da loja', url: 'https://loja.example/promocoes', interval: '1d', status: 'active', createdAt: at(24 * 6), updatedAt: at(2) },
    { id: 'fake-precos', name: null, url: 'https://loja.example/notebooks', interval: '0 9 * * 1', status: 'paused', createdAt: at(24 * 20), updatedAt: at(24 * 3) },
  ];
  const ticks: Record<string, TickView[]> = {
    'fake-promocoes': [
      {
        id: 't3',
        status: 'completed',
        createdAt: at(2),
        changed: true,
        added: 2,
        removed: 1,
        lines: [
          { type: 'removed', content: '- Notebook Aurora 14" por R$ 3.299,90' },
          { type: 'added', content: '- Notebook Aurora 14" por R$ 2.999,90' },
          { type: 'added', content: '- Mouse sem fio Brisa por R$ 89,90' },
        ],
      },
      { id: 't2', status: 'completed', createdAt: at(26), changed: false, added: 0, removed: 0, lines: [] },
      { id: 't1', status: 'failed', createdAt: at(50), changed: false, added: 0, removed: 0, lines: [] },
    ],
  };
  const find = (id: string) => {
    const m = monitors.find((x) => x.id === id);
    if (!m) throw new Error('monitor não encontrado');
    return m;
  };
  return {
    list: async () => monitors.map((m) => ({ ...m })),
    activity: async (id) => (find(id), ticks[id] ?? []),
    pause: async (id) => ({ ...Object.assign(find(id), { status: 'paused' as const }) }),
    resume: async (id) => ({ ...Object.assign(find(id), { status: 'active' as const }) }),
    remove: async (id) => {
      find(id);
      monitors.splice(monitors.findIndex((m) => m.id === id), 1);
    },
  };
}
