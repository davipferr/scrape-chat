// npm run server   (ou npm run dev:server, que reinicia ao salvar)

import { join } from 'node:path';
import { createApp } from './app.ts';
import { createAgentRunner } from './agent.ts';
import { ChatStore } from './chats.ts';
import { loadConfig } from './config.ts';
import { createFakeAgentRunner } from './fake-agent.ts';
import { SavedShortcutStore } from './saved.ts';
import { createFakeMonitors, createScrapeGraphMonitors } from './monitors.ts';
import { JobStore } from '../jobs/store.ts';

const config = loadConfig();
const fake = config.fakeAgent;
const jobs = new JobStore(config.dataRoot);
const chats = new ChatStore(config.dataRoot, fake ? createFakeAgentRunner(config.dataRoot) : createAgentRunner(config), jobs);
jobs.isActive = (id) => chats.isJobActive(id);

const app = createApp({
  chats,
  jobs,
  shortcuts: new SavedShortcutStore(config.dataRoot),
  monitors: fake ? createFakeMonitors() : createScrapeGraphMonitors(process.env.SGAI_API_KEY),
  staticDir: join(config.root, 'web/dist'),
  health: () => ({
    ok: true,
    fakeAgent: fake,
    model: fake ? 'agente-de-teste' : config.model,
    effort: config.effort,
    maxBudgetUsd: config.maxBudgetUsd,
    // Sem ANTHROPIC_API_KEY o agente usa o login do Claude Code nesta máquina.
    keys: { scrapegraph: Boolean(process.env.SGAI_API_KEY), anthropic: Boolean(process.env.ANTHROPIC_API_KEY) },
  }),
});

app.listen(config.port, config.host, () => {
  console.log(`scrape-chat ouvindo em http://${config.host}:${config.port}  (${fake ? 'agente de teste, sem API' : `modelo ${config.model}, esforço ${config.effort}`})`);
  if (!process.env.SGAI_API_KEY) console.log('  aviso: SGAI_API_KEY ausente no .env; só o motor browser vai funcionar');
});
