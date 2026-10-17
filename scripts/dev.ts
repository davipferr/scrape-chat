// npm run dev [-- --fake]
//
// Sobe o servidor (reiniciando ao salvar) e o Vite juntos. Abra http://localhost:5173.
// Com --fake, o servidor usa o agente de teste: nada de API nem créditos.

import { spawn } from 'node:child_process';

const fake = process.argv.includes('--fake');
const env = { ...process.env, ...(fake ? { SCRAPE_CHAT_FAKE_AGENT: '1' } : {}) };
const shell = process.platform === 'win32';

const children = [
  spawn('node', ['--watch-path=src', '--watch-path=scripts', 'src/server/main.ts'], { stdio: 'inherit', env }),
  spawn('npx', ['vite', '--config', 'web/vite.config.ts'], { stdio: 'inherit', env, shell }),
];

const stop = () => {
  for (const child of children) child.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => code && stop());
