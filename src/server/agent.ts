// O agente de verdade: Claude Code (via Agent SDK) rodando nesta pasta, com as
// skills de runtime e a política de ferramentas do scrape-chat.

import { query, type CanUseTool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AGENT_SKILLS, AGENT_TOOLS } from './policy.ts';
import type { Config } from './config.ts';

export interface TurnRequest {
  prompt: string;
  /** Sessão do SDK a continuar (a conversa anterior do mesmo chat). */
  resume: string | null;
  abortController: AbortController;
  canUseTool: CanUseTool;
}

/** Roda uma mensagem do usuário e devolve as mensagens do SDK. Os testes trocam por um falso. */
export type AgentRunner = (request: TurnRequest) => AsyncIterable<SDKMessage>;

const RUNTIME_PROMPT = `
Você é o agente do scrape-chat, uma ferramenta de web scraping por chat. Responda sempre em português do Brasil, curto e direto.

- Para QUALQUER pedido de extrair, raspar, coletar, buscar ou monitorar dados de sites, use a skill scrape-task. Ela diz como criar o job, escolher o motor e gravar o resultado.
- Você não está desenvolvendo este projeto: não edite código, skills nem configuração. Só grave dentro de data/jobs/.
- Algumas ações precisam do "sim" do usuário (monitores, crawl grande, usar o Chrome logado dele). A interface mostra um botão de aprovação quando você tentar; não peça a mesma coisa duas vezes.
- Se uma ferramenta for negada, leia o motivo e siga por outro caminho permitido, ou explique ao usuário o que falta.
- A interface mostra o resultado do job como tabela ao lado do chat. Na resposta, resuma: quantos itens, de onde, as suposições feitas e uma prévia curta.
`.trim();

export function createAgentRunner(config: Config): AgentRunner {
  return ({ prompt, resume, abortController, canUseTool }) =>
    query({
      prompt,
      options: {
        cwd: config.root,
        model: config.model,
        effort: config.effort,
        // 'project' carrega .claude/skills/ e o CLAUDE.md do repositório.
        settingSources: ['project'],
        skills: AGENT_SKILLS,
        tools: AGENT_TOOLS,
        permissionMode: 'default',
        canUseTool,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: RUNTIME_PROMPT },
        includePartialMessages: true,
        maxTurns: config.maxTurns,
        maxBudgetUsd: config.maxBudgetUsd,
        abortController,
        ...(resume ? { resume } : {}),
        env: agentEnv(),
      },
    });
}

/**
 * O ambiente do agente. Sem BROWSERBASE_API_KEY o `browse` sempre abre um
 * navegador local: com a chave, ele iria para a nuvem (CAPTCHA, proxies) mesmo sem --remote.
 */
function agentEnv(): Record<string, string> {
  const env: Record<string, string> = { CLAUDE_AGENT_SDK_CLIENT_APP: 'scrape-chat/0.1.0' };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'BROWSERBASE_API_KEY') env[key] = value;
  return env;
}
