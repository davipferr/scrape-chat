// Um agente de mentira para desenvolver a interface sem gastar API nem créditos.
// Liga com SCRAPE_CHAT_FAKE_AGENT=1. Ele encena um job de scraping completo:
// texto ao vivo, ferramentas, um job válido em data/jobs/ e, se o pedido falar
// em "monitor", um pedido de aprovação.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner } from './agent.ts';
import { JOBS_DIR, createJobDir, type Job, type ScrapeResult } from '../jobs/contract.ts';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sdk = (m: unknown) => m as SDKMessage;

const ROWS = [
  { nome: 'Notebook Aurora 14" i5 16GB', preco: 3299.9, avaliacao: 4.6, url: 'https://loja.example/p/aurora-14' },
  { nome: 'Notebook Aurora 16" i7 32GB', preco: 5899, avaliacao: 4.8, url: 'https://loja.example/p/aurora-16' },
  { nome: 'Ultrafino Brisa 13" Ryzen 5', preco: 2749.5, avaliacao: 4.3, url: 'https://loja.example/p/brisa-13' },
  { nome: 'Gamer Trovão 15" RTX', preco: 7499, avaliacao: 4.7, url: 'https://loja.example/p/trovao-15' },
  { nome: 'Chromebook Nuvem 11"', preco: 1299, avaliacao: null, url: 'https://loja.example/p/nuvem-11' },
  { nome: 'Conversível Dobra 14" i5', preco: 4120, avaliacao: 4.1, url: 'https://loja.example/p/dobra-14' },
];

export function createFakeAgentRunner(root: string): AgentRunner {
  let turn = 0;
  return async function* ({ prompt, canUseTool, abortController }) {
    const session = `fake-${Date.now()}`;
    const docs = /markdown|documenta|docs?/i.test(prompt);
    const id = createJobDir(root, docs ? 'guia-em-markdown' : 'precos-notebooks');
    const dir = `${JOBS_DIR}/${id}`;
    const signal = abortController.signal;
    const assistant = (content: unknown[]) => sdk({ type: 'assistant', parent_tool_use_id: null, session_id: session, message: { id: `msg-${turn++}`, content } });
    const toolResult = (toolUseId: string, content: string) =>
      sdk({ type: 'user', parent_tool_use_id: null, session_id: session, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: false }] } });
    const streamText = async function* (text: string) {
      for (const word of text.split(/(?<= )/)) {
        await pause(25);
        yield sdk({ type: 'stream_event', parent_tool_use_id: null, session_id: session, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word } } });
      }
      yield assistant([{ type: 'text', text }]);
    };

    yield sdk({ type: 'system', subtype: 'init', model: 'agente-de-teste', session_id: session });
    yield* streamText(docs ? 'Vou criar um job, varrer as páginas do guia em Markdown e conferir o resultado.' : 'Vou criar um job, extrair nome, preço e avaliação de cada notebook e conferir o resultado.');

    const steps: [string, string, () => void][] = [
      ['t1', 'npm run --silent job -- new "precos-notebooks"', () => {}],
      ['t2', `npx just-scrape validate --json`, () => {}],
      ['t3', `npx just-scrape extract "https://loja.example/notebooks" -p "Extraia cada notebook: nome, preço, avaliação e link" --schema '{...}' --json > ${dir}/raw/extract-1.json`, () => (docs ? writeDocsJob(root, id, prompt) : writeJob(root, id, prompt))],
      ['t4', `jq '.data.items | length' ${dir}/raw/extract-1.json`, () => (docs ? writeDocsResult(root, id) : writeResult(root, id))],
      ['t5', `npm run --silent job -- check ${id}`, () => {}],
    ];

    if (/monitor/i.test(prompt)) {
      const command = 'npx just-scrape monitor create --url "https://loja.example/notebooks" --interval 1d -f markdown';
      yield assistant([{ type: 'tool_use', id: 't0', name: 'Bash', input: { command } }]);
      const answer = await canUseTool('Bash', { command }, { signal, toolUseID: 't0' } as never);
      yield toolResult('t0', answer?.behavior === 'allow' ? 'monitor criado (de mentira)' : 'negado');
    }

    for (const [toolId, command, effect] of steps) {
      if (signal.aborted) throw new Error('aborted');
      yield assistant([{ type: 'tool_use', id: toolId, name: 'Bash', input: { command } }]);
      await pause(450);
      effect();
      yield toolResult(toolId, toolId === 't1' ? dir : 'ok');
    }

    if (docs) {
      yield* streamText(`Baixei **${DOCS.length} páginas** do guia em Markdown. Abri ao lado para você ler ou baixar tudo num arquivo.`);
      yield sdk({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0, duration_ms: 2900, session_id: session });
      return;
    }
    yield* streamText(
      [
        `Encontrei **${ROWS.length} notebooks** em loja.example/notebooks.`,
        '',
        '| nome | preço |',
        '|---|---|',
        ...ROWS.slice(0, 3).map((r) => `| ${r.nome} | R$ ${r.preco.toLocaleString('pt-BR')} |`),
        '',
        'Considerei só a primeira página. Peça "todas as páginas" para seguir a paginação.',
      ].join('\n'),
    );
    yield sdk({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0, duration_ms: 3200, session_id: session });
  };
}

function writeJob(root: string, id: string, request: string): void {
  const job: Job = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    request,
    goal: 'Nome, preço, avaliação e link de cada notebook da primeira página',
    engine: 'just-scrape',
    operation: 'extract',
    targets: ['https://loja.example/notebooks'],
    prompt: 'Extraia cada notebook: nome, preço em reais (número), avaliação de 0 a 5 e link',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { nome: { type: 'string' }, preco: { type: ['number', 'null'] }, avaliacao: { type: ['number', 'null'] }, url: { type: 'string' } },
            required: ['nome', 'preco', 'url'],
          },
        },
      },
    },
    shape: 'table',
    options: {},
    assumptions: ['só a primeira página da categoria', 'preço à vista, sem frete', 'avaliação vazia quando o produto não tem notas'],
  };
  writeFileSync(join(root, JOBS_DIR, id, 'job.json'), JSON.stringify(job, null, 2));
}

function writeResult(root: string, id: string): void {
  const result: ScrapeResult = {
    version: 1,
    jobId: id,
    status: 'done',
    finishedAt: new Date().toISOString(),
    commands: [`npx just-scrape extract "https://loja.example/notebooks" -p "..." --schema '...' --json > ${JOBS_DIR}/${id}/raw/extract-1.json`],
    columns: ['nome', 'preco', 'avaliacao', 'url'],
    rows: ROWS,
    sources: ['https://loja.example/notebooks'],
    warnings: ['1 produto sem avaliação'],
    error: null,
  };
  writeFileSync(join(root, JOBS_DIR, id, 'result.json'), JSON.stringify(result, null, 2));
}

const DOCS = [
  {url: "https://docs.example.com/guia",title: "Guia: primeiros passos",markdown: "# Primeiros passos\n\nInstale com `npm install exemplo` e rode `exemplo init`.\n\n## Requisitos\n\n- Node 22 ou mais novo\n- Uma conta no painel\n\nDepois disso, siga para **Configuração**."},
  {url: "https://docs.example.com/guia/configuracao",title: "Configuração",markdown: "# Configuração\n\nO arquivo `exemplo.json` aceita:\n\n| chave | padrão |\n|---|---|\n| porta | 3000 |\n| idioma | pt-BR |"},
  {url: "https://docs.example.com/guia/deploy",title: "Deploy",markdown: "# Deploy\n\n1. Rode `exemplo build`.\n2. Envie a pasta `dist/`.\n3. Confira os logs."},
];

function writeDocsJob(root: string, id: string, request: string): void {
  const job: Job = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    request,
    goal: 'As páginas do guia em Markdown',
    engine: 'just-scrape',
    operation: 'crawl',
    targets: ['https://docs.example.com/guia'],
    prompt: null,
    schema: null,
    shape: 'documents',
    options: { maxPages: 20, maxDepth: 2, includePatterns: ['^https://docs.example.com/guia.*'] },
    assumptions: ['até 20 páginas, presas a /guia', 'sem imagens, só o texto'],
  };
  writeFileSync(join(root, JOBS_DIR, id, 'job.json'), JSON.stringify(job, null, 2));
}

function writeDocsResult(root: string, id: string): void {
  const result: ScrapeResult = {
    version: 1,
    jobId: id,
    status: 'done',
    finishedAt: new Date().toISOString(),
    commands: [`npx just-scrape crawl "https://docs.example.com/guia" -f markdown --max-pages 20 --max-depth 2 --json > ${JOBS_DIR}/${id}/raw/crawl-1.json`],
    documents: DOCS,
    sources: DOCS.map((d) => d.url),
    warnings: [],
    error: null,
  };
  writeFileSync(join(root, JOBS_DIR, id, 'result.json'), JSON.stringify(result, null, 2));
}
