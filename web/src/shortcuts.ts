// Atalhos de um clique: pedidos prontos que só precisam de um link (ou de um
// assunto). O usuário cola o link no campo e clica; o texto que sobrar no campo
// vira instrução extra. Lógica pura, testada em test/shortcuts.test.ts.

import type { JobSummary } from './api.ts';

export interface Shortcut {
  id: string;
  label: string;
  /** O que o atalho precisa no campo: um link, ou qualquer texto (busca). */
  needs: 'url' | 'text';
  /** Uma frase para o title do botão. */
  hint: string;
  build: (target: string, extra: string) => string;
}

const withExtra = (base: string, extra: string) => (extra ? `${base} Além disso: ${extra}` : base);

export const SHORTCUTS: Shortcut[] = [
  {
    id: 'list',
    label: 'Extrair a lista',
    needs: 'url',
    hint: 'Cada item listado na página vira uma linha, com os campos que fizerem sentido',
    build: (url, extra) => withExtra(`Extraia todos os itens listados em ${url}, um por linha, com os campos que fizerem sentido para esse tipo de página.`, extra),
  },
  {
    id: 'pages',
    label: 'Todas as páginas',
    needs: 'url',
    hint: 'Mesmo que "Extrair a lista", seguindo a paginação até o fim',
    build: (url, extra) => withExtra(`Extraia todos os itens listados em ${url} e siga a paginação até a última página (no máximo 10), juntando tudo numa tabela só.`, extra),
  },
  {
    id: 'tables',
    label: 'Tabelas da página',
    needs: 'url',
    hint: 'As tabelas que já existem na página, linha por linha',
    build: (url, extra) => withExtra(`Extraia as tabelas de ${url} exatamente como aparecem, uma linha por linha da tabela, com os cabeçalhos como colunas.`, extra),
  },
  {
    id: 'markdown',
    label: 'Texto em Markdown',
    needs: 'url',
    hint: 'O conteúdo da página, limpo, para ler ou guardar',
    build: (url, extra) => withExtra(`Baixe o conteúdo principal de ${url} em Markdown, sem menus nem rodapés.`, extra),
  },
  {
    id: 'section',
    label: 'Seção inteira',
    needs: 'url',
    hint: 'Todas as páginas abaixo deste endereço, em Markdown (bom para documentação)',
    build: (url, extra) => withExtra(`Baixe em Markdown todas as páginas abaixo de ${url}, presas a esse caminho, até 20 páginas.`, extra),
  },
  {
    id: 'monitor',
    label: 'Avisar quando mudar',
    needs: 'url',
    hint: 'Cria um monitor diário (pede sua aprovação, porque gasta créditos)',
    build: (url, extra) => withExtra(`Monitore ${url} uma vez por dia e me avise quando o conteúdo mudar.`, extra),
  },
  {
    id: 'search',
    label: 'Buscar na web',
    needs: 'text',
    hint: 'Sem link: o agente procura as fontes e monta a tabela',
    build: (query) => `Busque na web: ${query}. Traga os resultados como tabela, com a fonte de cada linha.`,
  },
];

const URL_RE = /https?:\/\/[^\s<>"')]+/g;

export type Composed = { ok: true; message: string } | { ok: false; reason: string };

/** Junta o atalho com o que está no campo de mensagem. */
export function compose(shortcut: Shortcut, input: string): Composed {
  const text = input.trim();
  if (shortcut.needs === 'text') {
    return text ? { ok: true, message: shortcut.build(text, '') } : { ok: false, reason: 'Escreva o que procurar e clique de novo.' };
  }
  const urls = [...new Set(text.match(URL_RE) ?? [])].map((u) => u.replace(/[.,;:]+$/, ''));
  if (urls.length === 0) return { ok: false, reason: 'Cole um link no campo e clique de novo.' };
  const extra = text
    .replace(URL_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.-]+/, '')
    .trim();
  const target = urls.length === 1 ? urls[0]! : `${urls.slice(0, -1).join(', ')} e ${urls.at(-1)}`;
  return { ok: true, message: shortcut.build(target, extra) };
}

// ---------- depois de um job ----------

export interface FollowUp {
  id: string;
  label: string;
  message: string;
}

/** O que dá para pedir em seguida a partir de um job pronto. */
export function followUps(job: JobSummary, source: string | null): FollowUp[] {
  if (job.status === 'running' || job.status === 'invalid') return [];
  const ref = `job ${job.id}${job.goal ? ` ("${job.goal}")` : ''}`;
  const out: FollowUp[] = [{ id: 'again', label: 'Rodar de novo', message: `Rode de novo o ${ref} com o mesmo plano, num job novo, e diga o que mudou em relação ao anterior.` }];
  if (job.status === 'stopped') {
    out[0] = { id: 'again', label: 'Tentar de novo', message: `O ${ref} parou antes de terminar. Tente de novo num job novo, com o mesmo plano.` };
    return out;
  }
  if (job.status === 'blocked' || job.status === 'failed') {
    out[0] = { id: 'again', label: 'Tentar de outro jeito', message: `O ${ref} não deu certo. Tente outro caminho permitido (outro motor ou outra fonte) num job novo.` };
    return out;
  }
  if (job.shape === 'table' && job.operation !== 'crawl') {
    out.push({ id: 'pages', label: 'Seguir a paginação', message: `No ${ref}, siga a paginação até a última página (no máximo 10) e junte tudo num job novo.` });
  }
  if (source) out.push({ id: 'monitor', label: 'Avisar quando mudar', message: `Monitore ${source} uma vez por dia e me avise quando ${job.goal ? `"${job.goal}"` : 'o conteúdo'} mudar.` });
  return out;
}
