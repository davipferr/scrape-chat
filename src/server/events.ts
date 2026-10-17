// Os eventos que a interface recebe por SSE. Traduz as mensagens do Agent SDK
// (muito detalhadas) para o pouco que o chat precisa mostrar.

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { JobSummary } from '../jobs/store.ts';

export type ChatEventBody =
  | { type: 'user'; text: string }
  | { type: 'session'; model: string }
  /** Pedaço de texto ao vivo. O próximo `text` ou `tool` traz a versão final e o rascunho some. */
  | { type: 'text-delta'; text: string }
  | { type: 'text'; blockId: string; text: string }
  | { type: 'tool'; toolUseId: string; name: string; summary: string }
  | { type: 'tool-result'; toolUseId: string; ok: boolean }
  | { type: 'approval'; approvalId: string; tool: string; summary: string; reason: string }
  | { type: 'approval-resolved'; approvalId: string; allowed: boolean }
  | { type: 'job'; job: JobSummary }
  | { type: 'done'; ok: boolean; costUsd: number; durationMs: number; error?: string };

export type ChatEvent = ChatEventBody & { seq: number; at: string };

/** Resumo de uma chamada de ferramenta em uma linha, para o chat. */
export function summarizeTool(name: string, input: Record<string, unknown>): string {
  const text =
    name === 'Bash'
      ? String(input.command ?? '')
      : String(input.file_path ?? input.url ?? input.pattern ?? input.skill ?? input.path ?? '');
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

// O id aparece sozinho (`npm run job -- check <id>`) ou num caminho (`data/jobs/<id>/...`).
const JOB_PATH = /(?<![\w-])(\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*)/g;

/** Ids de job citados num texto qualquer (comando, caminho, saída de ferramenta). */
export function jobIdsIn(text: string): string[] {
  return [...new Set([...text.matchAll(JOB_PATH)].map((m) => m[1]!))];
}

/**
 * Converte uma mensagem do SDK nos eventos do chat. Ignora o que vem de
 * subagentes (`parent_tool_use_id`) e as mensagens de sistema que não importam.
 * `touched` recebe os ids de job que aparecerem, para o chat acompanhar.
 */
export function mapSdkMessage(message: SDKMessage, touched: Set<string>): ChatEventBody[] {
  switch (message.type) {
    case 'system':
      return message.subtype === 'init' ? [{ type: 'session', model: message.model }] : [];
    case 'stream_event': {
      if (message.parent_tool_use_id !== null) return [];
      const event = message.event;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        return [{ type: 'text-delta', text: event.delta.text }];
      }
      return [];
    }
    case 'assistant': {
      if (message.parent_tool_use_id !== null) return [];
      const out: ChatEventBody[] = [];
      message.message.content.forEach((block, i) => {
        if (block.type === 'text' && block.text.trim()) out.push({ type: 'text', blockId: `${message.message.id}:${i}`, text: block.text });
        if (block.type === 'tool_use') {
          const input = (block.input ?? {}) as Record<string, unknown>;
          for (const id of jobIdsIn(JSON.stringify(input))) touched.add(id);
          out.push({ type: 'tool', toolUseId: block.id, name: block.name, summary: summarizeTool(block.name, input) });
        }
      });
      return out;
    }
    case 'user': {
      if (message.parent_tool_use_id !== null) return [];
      const content = message.message.content;
      if (typeof content === 'string') return [];
      const out: ChatEventBody[] = [];
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        for (const id of jobIdsIn(JSON.stringify(block.content ?? ''))) touched.add(id);
        out.push({ type: 'tool-result', toolUseId: block.tool_use_id, ok: !block.is_error });
      }
      return out;
    }
    case 'result':
      return [
        {
          type: 'done',
          ok: message.subtype === 'success' && !message.is_error,
          costUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
          ...(message.subtype === 'success' ? (message.is_error ? { error: message.result } : {}) : { error: errorText(message.subtype, message.errors) }),
        },
      ];
    default:
      return [];
  }
}

function errorText(subtype: string, errors: string[]): string {
  const why: Record<string, string> = {
    error_max_turns: 'o agente atingiu o limite de passos',
    error_max_budget_usd: 'o agente atingiu o limite de gasto desta mensagem',
    error_during_execution: 'erro durante a execução',
  };
  return [why[subtype] ?? subtype, ...errors].join(': ');
}
