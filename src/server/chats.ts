// Um chat = uma conversa com o agente, salva em data/chats/<id>.json.
// Cada mensagem do usuário vira um turno do Agent SDK que continua a sessão
// anterior (`resume`), e cada coisa que acontece vira um ChatEvent para o SSE.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner } from './agent.ts';
import { mapSdkMessage, summarizeTool, type ChatEvent, type ChatEventBody } from './events.ts';
import { decide } from './policy.ts';
import type { JobStore } from '../jobs/store.ts';

export const CHATS_DIR = 'data/chats';
/** Quanto tempo um pedido de aprovação espera antes de virar "não". */
export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
/** Depois de "Parar", quanto o agente tem para encerrar sozinho antes de o turno ser fechado à força. */
export const STOP_GRACE_MS = 5000;
export const RESTART_ERROR = 'interrompido: o servidor foi reiniciado no meio da resposta';

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  sdkSessionId: string | null;
  events: ChatEvent[];
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
  running: boolean;
}

interface Live {
  abort: AbortController | null;
  /** Número do turno atual. Eventos de um turno antigo (fechado à força) são descartados. */
  turn: number;
  /** Jobs que o turno em andamento já tocou: contam como "rodando". */
  jobs: Set<string>;
  listeners: Set<(event: ChatEvent) => void>;
  approvals: Map<string, (allowed: boolean) => void>;
}

export class ChatBusyError extends Error {}

export class ChatStore {
  private readonly dir: string;
  private readonly chats = new Map<string, Chat>();
  private readonly live = new Map<string, Live>();
  private readonly root: string;
  private readonly runner: AgentRunner;
  private readonly jobs: JobStore;
  private readonly stopGraceMs: number;

  constructor(root: string, runner: AgentRunner, jobs: JobStore, options: { stopGraceMs?: number } = {}) {
    this.stopGraceMs = options.stopGraceMs ?? STOP_GRACE_MS;
    this.root = root;
    this.runner = runner;
    this.jobs = jobs;
    this.dir = join(root, CHATS_DIR);
    mkdirSync(this.dir, { recursive: true });
    for (const file of readdirSync(this.dir).filter((f) => f.endsWith('.json'))) {
      try {
        const chat = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as Chat;
        this.chats.set(chat.id, chat);
        this.closeOrphanTurn(chat);
      } catch {
        // arquivo corrompido: ignora em vez de derrubar o servidor
      }
    }
  }

  /** Um turno sem `done` no arquivo é de um servidor que caiu ou reiniciou: ninguém mais vai terminá-lo. */
  private closeOrphanTurn(chat: Chat): void {
    const lastUser = chat.events.findLastIndex((e) => e.type === 'user');
    const lastDone = chat.events.findLastIndex((e) => e.type === 'done');
    if (lastUser <= lastDone) return;
    this.emit(chat, { type: 'done', ok: false, costUsd: 0, durationMs: 0, error: RESTART_ERROR });
  }

  /** Algum turno em andamento está trabalhando neste job? */
  isJobActive(jobId: string): boolean {
    for (const live of this.live.values()) if (live.abort && live.jobs.has(jobId)) return true;
    return false;
  }

  list(): ChatSummary[] {
    return [...this.chats.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, running: this.isRunning(c.id) }));
  }

  get(id: string): Chat | undefined {
    return this.chats.get(id);
  }

  create(title?: string): Chat {
    const chat: Chat = { id: randomUUID(), title: title?.trim() || 'Nova conversa', createdAt: new Date().toISOString(), sdkSessionId: null, events: [] };
    this.chats.set(chat.id, chat);
    this.save(chat);
    return chat;
  }

  /** De qual conversa saiu cada job (pelo evento `job`). */
  jobChats(): Map<string, string> {
    const map = new Map<string, string>();
    for (const chat of this.chats.values()) for (const e of chat.events) if (e.type === 'job') map.set(e.job.id, chat.id);
    return map;
  }

  isRunning(id: string): boolean {
    return this.live.get(id)?.abort != null;
  }

  /** Recebe os eventos novos do chat. Devolve a função que cancela a inscrição. */
  subscribe(id: string, listener: (event: ChatEvent) => void): () => void {
    const live = this.liveOf(id);
    live.listeners.add(listener);
    return () => live.listeners.delete(listener);
  }

  /** Começa um turno. Não espera o fim: o progresso chega por `subscribe`. */
  send(id: string, text: string): Promise<void> {
    const chat = this.chats.get(id);
    if (!chat) throw new Error(`chat não encontrado: ${id}`);
    if (this.isRunning(id)) throw new ChatBusyError('o agente ainda está respondendo a mensagem anterior');
    const live = this.liveOf(id);
    const abort = new AbortController();
    live.abort = abort;
    const turn = ++live.turn;
    if (chat.events.length === 0 && chat.title === 'Nova conversa') chat.title = text.trim().replace(/\s+/g, ' ').slice(0, 60);
    this.emit(chat, { type: 'user', text });
    return this.runTurn(chat, text, abort, turn).finally(() => {
      if (live.turn === turn) this.finishTurn(chat, live);
    });
  }

  /**
   * Para o turno em andamento. O agente recebe o aviso na hora; se não encerrar
   * em STOP_GRACE_MS (travado numa ferramenta, por exemplo), o turno é fechado
   * mesmo assim e o que ele mandar depois é descartado.
   */
  stop(id: string): boolean {
    const live = this.live.get(id);
    const chat = this.chats.get(id);
    if (!live?.abort || !chat) return false;
    const turn = live.turn;
    live.abort.abort();
    setTimeout(() => {
      if (live.turn !== turn || !live.abort) return;
      this.emit(chat, { type: 'done', ok: false, costUsd: 0, durationMs: 0, error: 'interrompido' });
      live.turn++;
      this.finishTurn(chat, live);
    }, this.stopGraceMs).unref();
    return true;
  }

  /** Libera a conversa para a próxima mensagem e mostra como ficaram os jobs que o turno tocou. */
  private finishTurn(chat: Chat, live: Live): void {
    live.abort = null;
    for (const resolve of live.approvals.values()) resolve(false);
    live.approvals.clear();
    const touched = [...live.jobs];
    live.jobs.clear();
    // Um job sem result.json deixa de ser "rodando" e vira "interrompido".
    for (const jobId of touched) {
      const summary = this.jobs.get(jobId)?.summary;
      if (summary && summary.status === 'stopped') this.emit(chat, { type: 'job', job: summary });
    }
    this.save(chat);
  }

  /** Responde a um pedido de aprovação. `false` se ele não existe mais. */
  resolveApproval(id: string, approvalId: string, allowed: boolean): boolean {
    const resolve = this.live.get(id)?.approvals.get(approvalId);
    if (!resolve) return false;
    resolve(allowed);
    return true;
  }

  private async runTurn(chat: Chat, prompt: string, abort: AbortController, turn: number): Promise<void> {
    const live = this.liveOf(chat.id);
    const touched = live.jobs;
    const current = () => live.turn === turn;
    const shown = new Map<string, string>();
    const showJobs = () => {
      for (const jobId of touched) {
        const summary = this.jobs.get(jobId)?.summary;
        if (!summary) continue;
        const key = `${summary.status}:${summary.items}`;
        if (shown.get(jobId) === key) continue;
        shown.set(jobId, key);
        this.emit(chat, { type: 'job', job: summary });
      }
    };
    let finished = false;
    try {
      for await (const message of this.runner({ prompt, resume: chat.sdkSessionId, abortController: abort, canUseTool: this.permissionHandler(chat) })) {
        if (!current()) break;
        if (message.type === 'system' && message.subtype === 'init') chat.sdkSessionId = message.session_id;
        for (const body of mapSdkMessage(message, touched)) {
          if (body.type === 'done') finished = true;
          this.emit(chat, body);
        }
        if (message.type === 'user' || message.type === 'result') showJobs();
      }
      if (!finished && current()) this.emit(chat, { type: 'done', ok: false, costUsd: 0, durationMs: 0, error: abort.signal.aborted ? 'interrompido' : 'o agente parou sem resposta' });
    } catch (e) {
      if (!current()) return;
      showJobs();
      const error = abort.signal.aborted ? 'interrompido' : (e as Error).message;
      this.emit(chat, { type: 'done', ok: false, costUsd: 0, durationMs: 0, error });
    }
  }

  private permissionHandler(chat: Chat): CanUseTool {
    return async (tool, input, { signal }): Promise<PermissionResult> => {
      const decision = decide(tool, input, this.root);
      if (decision.kind === 'allow') return { behavior: 'allow', updatedInput: input };
      if (decision.kind === 'deny') return { behavior: 'deny', message: `Bloqueado pelo scrape-chat: ${decision.reason}` };

      const approvalId = randomUUID();
      const live = this.liveOf(chat.id);
      this.emit(chat, { type: 'approval', approvalId, tool, summary: summarizeTool(tool, input), reason: decision.reason });
      const allowed = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), APPROVAL_TIMEOUT_MS);
        const done = (value: boolean) => {
          clearTimeout(timer);
          live.approvals.delete(approvalId);
          resolve(value);
        };
        live.approvals.set(approvalId, done);
        signal.addEventListener('abort', () => done(false), { once: true });
      });
      this.emit(chat, { type: 'approval-resolved', approvalId, allowed });
      return allowed
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: `O usuário não aprovou: ${decision.reason}. Siga sem isso ou pergunte o que ele prefere.` };
    };
  }

  private emit(chat: Chat, body: ChatEventBody): void {
    const last = chat.events.at(-1)?.seq ?? 0;
    // Pedaços de texto são só ao vivo: não vão para o arquivo nem gastam número.
    const transient = body.type === 'text-delta';
    const event = { ...body, seq: transient ? last : last + 1, at: new Date().toISOString() } as ChatEvent;
    if (!transient) {
      chat.events.push(event);
      // Salva a cada evento: se o servidor cair no meio, a conversa não se perde.
      this.save(chat);
    }
    for (const listener of this.liveOf(chat.id).listeners) listener(event);
  }

  private liveOf(id: string): Live {
    let live = this.live.get(id);
    if (!live) {
      live = { abort: null, turn: 0, jobs: new Set(), listeners: new Set(), approvals: new Map() };
      this.live.set(id, live);
    }
    return live;
  }

  private save(chat: Chat): void {
    writeFileSync(join(this.dir, `${chat.id}.json`), JSON.stringify(chat, null, 2));
  }
}
