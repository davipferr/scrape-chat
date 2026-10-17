// A API HTTP do scrape-chat. Só node:http, sem framework: são poucas rotas.
//
//   GET  /api/health                         modelo e quais chaves estão configuradas
//   GET  /api/chats                          lista de conversas
//   POST /api/chats              {title?}    nova conversa
//   GET  /api/chats/:id                      conversa com todos os eventos
//   POST /api/chats/:id/messages {text}      manda uma mensagem (202; progresso no stream)
//   GET  /api/chats/:id/stream?after=N       SSE: eventos depois de N, e os novos ao vivo
//   POST /api/chats/:id/approvals/:aid {allow}  responde a um pedido de aprovação
//   POST /api/chats/:id/stop                 interrompe o turno em andamento
//   GET  /api/jobs                           jobs em data/jobs/, mais novos primeiro
//   GET  /api/jobs/:id                       job.json + result.json + problemas do contrato
//   GET  /api/monitors                       monitores da ScrapeGraph (+ job que criou cada um)
//   GET  /api/monitors/:id/activity          últimas execuções e o que mudou
//   POST /api/monitors/:id/pause | resume    pausa ou retoma
//   DELETE /api/monitors/:id                 apaga o monitor
//   GET  /api/shortcuts                      atalhos salvos
//   POST /api/shortcuts          {label, text}  salva um atalho
//   DELETE /api/shortcuts/:id                apaga um atalho
//   GET  /*                                  a interface (web/dist), quando compilada

import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { ChatBusyError, type ChatStore } from './chats.ts';
import type { JobStore } from '../jobs/store.ts';
import type { SavedShortcutStore } from './saved.ts';
import { MonitorsUnavailable, type MonitorClient } from './monitors.ts';

export interface AppDeps {
  chats: ChatStore;
  jobs: JobStore;
  shortcuts: SavedShortcutStore;
  monitors: MonitorClient;
  health: () => Record<string, unknown>;
  /** Pasta da interface compilada. Sem ela, só a API responde. */
  staticDir?: string;
}

const MAX_BODY = 64 * 1024;
const HEARTBEAT_MS = 15_000;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], url: URL) => Promise<void> | void;
interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

export function createApp(deps: AppDeps): Server {
  const { chats, jobs, shortcuts, monitors } = deps;
  /** Erros da ScrapeGraph viram 502; falta de chave vira 503 com a explicação. */
  const remote = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (e) {
      if (e instanceof MonitorsUnavailable) fail(503, e.message);
      if (/não encontrado|not.found/i.test((e as Error).message)) fail(404, 'monitor não encontrado');
      return fail(502, `ScrapeGraph AI: ${(e as Error).message}`);
    }
  };
  const chatOr404 = (id: string) => chats.get(id) ?? fail(404, 'conversa não encontrada');

  const routes: Route[] = [
    { method: 'GET', pattern: /^\/api\/health$/, handler: (_q, res) => json(res, 200, deps.health()) },
    { method: 'GET', pattern: /^\/api\/chats$/, handler: (_q, res) => json(res, 200, chats.list()) },
    {
      method: 'POST',
      pattern: /^\/api\/chats$/,
      handler: async (req, res) => {
        const body = await readBody(req);
        const chat = chats.create(typeof body.title === 'string' ? body.title : undefined);
        json(res, 201, chat);
      },
    },
    { method: 'GET', pattern: /^\/api\/chats\/([\w-]+)$/, handler: (_q, res, [id]) => json(res, 200, { ...chatOr404(id!), running: chats.isRunning(id!) }) },
    {
      method: 'POST',
      pattern: /^\/api\/chats\/([\w-]+)\/messages$/,
      handler: async (req, res, [id]) => {
        chatOr404(id!);
        const { text } = await readBody(req);
        if (typeof text !== 'string' || !text.trim()) fail(400, '`text` é obrigatório');
        try {
          void chats.send(id!, text).catch(() => {});
        } catch (e) {
          if (e instanceof ChatBusyError) fail(409, e.message);
          throw e;
        }
        json(res, 202, { accepted: true });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/chats\/([\w-]+)\/stream$/,
      handler: (req, res, [id], url) => {
        const chat = chatOr404(id!);
        const after = Number(url.searchParams.get('after') ?? req.headers['last-event-id'] ?? 0) || 0;
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        // Sem um primeiro pedaço, o Node segura os cabeçalhos até o próximo evento (ou o ping de 15 s).
        res.write(': conectado\n\n');
        const send = (event: { seq: number }) => res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
        for (const event of chat.events) if (event.seq > after) send(event);
        const unsubscribe = chats.subscribe(id!, send);
        const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
        req.on('close', () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/chats\/([\w-]+)\/approvals\/([\w-]+)$/,
      handler: async (req, res, [id, approvalId]) => {
        chatOr404(id!);
        const { allow } = await readBody(req);
        if (typeof allow !== 'boolean') fail(400, '`allow` precisa ser true ou false');
        if (!chats.resolveApproval(id!, approvalId!, allow)) fail(404, 'pedido de aprovação não existe mais');
        json(res, 200, { ok: true });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/chats\/([\w-]+)\/stop$/,
      handler: (_q, res, [id]) => {
        chatOr404(id!);
        json(res, 200, { stopped: chats.stop(id!) });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/jobs$/,
      handler: (_q, res) => {
        const owners = chats.jobChats();
        json(res, 200, jobs.list().map((j) => ({ ...j, chatId: owners.get(j.id) ?? null })));
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/monitors$/,
      handler: async (_q, res) => {
        try {
          const list = await monitors.list();
          const owners = jobs.monitorJobs();
          json(res, 200, { available: true, monitors: list.map((m) => ({ ...m, jobId: owners.get(m.id) ?? null })) });
        } catch (e) {
          if (e instanceof MonitorsUnavailable) return json(res, 200, { available: false, reason: e.message, monitors: [] });
          fail(502, `ScrapeGraph AI: ${(e as Error).message}`);
        }
      },
    },
    { method: 'GET', pattern: /^\/api\/monitors\/([\w-]+)\/activity$/, handler: async (_q, res, [id]) => json(res, 200, await remote(() => monitors.activity(id!))) },
    { method: 'POST', pattern: /^\/api\/monitors\/([\w-]+)\/pause$/, handler: async (_q, res, [id]) => json(res, 200, await remote(() => monitors.pause(id!))) },
    { method: 'POST', pattern: /^\/api\/monitors\/([\w-]+)\/resume$/, handler: async (_q, res, [id]) => json(res, 200, await remote(() => monitors.resume(id!))) },
    {
      method: 'DELETE',
      pattern: /^\/api\/monitors\/([\w-]+)$/,
      handler: async (_q, res, [id]) => {
        await remote(() => monitors.remove(id!));
        json(res, 200, { ok: true });
      },
    },
    { method: 'GET', pattern: /^\/api\/shortcuts$/, handler: (_q, res) => json(res, 200, shortcuts.list()) },
    {
      method: 'POST',
      pattern: /^\/api\/shortcuts$/,
      handler: async (req, res) => {
        const { label, text } = await readBody(req);
        if (typeof label !== 'string' || typeof text !== 'string') fail(400, '`label` e `text` são obrigatórios');
        try {
          json(res, 201, shortcuts.add(label, text));
        } catch (e) {
          fail(400, (e as Error).message);
        }
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/shortcuts\/([\w-]+)$/,
      handler: (_q, res, [id]) => (shortcuts.remove(id!) ? json(res, 200, { ok: true }) : fail(404, 'atalho não encontrado')),
    },
    { method: 'GET', pattern: /^\/api\/jobs\/([\w-]+)$/, handler: (_q, res, [id]) => json(res, 200, jobs.get(id!) ?? fail(404, 'job não encontrado')) },
  ];

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const matches = routes.filter((r) => r.pattern.test(url.pathname));
    const route = matches.find((r) => r.method === req.method);
    try {
      if (!url.pathname.startsWith('/api/') && deps.staticDir && (req.method === 'GET' || req.method === 'HEAD')) return await serveStatic(res, deps.staticDir, url.pathname);
      if (!route) fail(matches.length ? 405 : 404, matches.length ? 'método não permitido' : 'rota não encontrada');
      const params = route.pattern.exec(url.pathname)!.slice(1);
      await route.handler(req, res, params, url);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) json(res, status, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    }
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** A interface compilada (web/dist). Caminho desconhecido cai no index.html. */
async function serveStatic(res: ServerResponse, dir: string, pathname: string): Promise<void> {
  const root = resolve(dir);
  let file = resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(root + sep) && file !== root) fail(404, 'rota não encontrada');
  const isFile = await stat(file).then((s) => s.isFile(), () => false);
  if (!isFile) file = join(root, 'index.html');
  const body = await readFile(file).catch(() => fail(404, 'interface não compilada: rode `npm run build`'));
  const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
  res.end(body);
}

function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) fail(413, 'corpo da requisição grande demais');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : fail(400, 'o corpo precisa ser um objeto JSON');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return fail(400, 'JSON inválido');
  }
}
