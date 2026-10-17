import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Config {
  /** Pasta do projeto: onde o agente roda e acha as skills. */
  root: string;
  /**
   * Onde ficam data/jobs, data/chats e data/shortcuts.json. É a própria `root`,
   * exceto nos testes com o agente de teste (SCRAPE_CHAT_DATA_ROOT), para não
   * misturar com os seus dados.
   */
  dataRoot: string;
  fakeAgent: boolean;
  host: string;
  port: number;
  model: string;
  effort: Effort;
  maxTurns: number;
  /** Teto de gasto do agente por mensagem, em dólares. Não inclui créditos da ScrapeGraph. */
  maxBudgetUsd: number;
}

/** Lê o .env da raiz (se existir) e monta a configuração a partir de process.env. */
export function loadConfig(root = process.cwd()): Config {
  const abs = resolve(root);
  const envFile = join(abs, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  // Uma linha `ANTHROPIC_API_KEY=` vazia copiada do .env.example ganharia do
  // login do Claude Code e quebraria a autenticação: variável vazia é variável ausente.
  for (const [key, value] of Object.entries(process.env)) if (value === '') delete process.env[key];

  const env = process.env;
  const effort = (env.SCRAPE_CHAT_EFFORT ?? 'high') as Effort;
  const fakeAgent = env.SCRAPE_CHAT_FAKE_AGENT === '1';
  // O agente de verdade grava em data/jobs relativo à pasta do projeto: outra pasta de dados só com o agente de teste.
  const dataRoot = fakeAgent && env.SCRAPE_CHAT_DATA_ROOT ? resolve(env.SCRAPE_CHAT_DATA_ROOT) : abs;
  return {
    root: abs,
    dataRoot,
    fakeAgent,
    host: env.SCRAPE_CHAT_HOST ?? '127.0.0.1',
    port: Number(env.SCRAPE_CHAT_PORT ?? 8787),
    model: env.SCRAPE_CHAT_MODEL ?? 'claude-opus-5-5',
    effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort) ? effort : 'high',
    maxTurns: Number(env.SCRAPE_CHAT_MAX_TURNS ?? 80),
    maxBudgetUsd: Number(env.SCRAPE_CHAT_MAX_USD ?? 2),
  };
}
