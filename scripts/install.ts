// npm run setup [-- --dry-run] [-- --local-only]
//
// Instala, para cada agente do skills.json:
//   1. as skills externas (do skills.sh / GitHub) listadas em skills.json
//   2. as skills locais desta pasta skills/
// usando o CLI oficial `skills` (o mesmo do site skills.sh).
//
// O CLI COPIA as skills locais para .agents/skills/ (e cria um link em
// .claude/skills/). Por isso, depois de editar algo em skills/, rode o setup de novo.
// O `npm run validate` avisa quando a cópia instalada ficou para trás.

import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadProject, printIssues, bold, dim, green, red } from './lib/project.ts';
import { installCommands, listLocalSkillDirs } from './lib/skills.ts';

const { values } = parseArgs({
  options: { 'dry-run': { type: 'boolean' }, 'local-only': { type: 'boolean' }, root: { type: 'string' } },
});
const project = loadProject(values.root);
if (!project.manifest) {
  printIssues(project.issues);
  process.exit(1);
}

const local = listLocalSkillDirs(project.root);
const manifest = values['local-only'] ? { ...project.manifest, external: [] } : project.manifest;
const commands = installCommands(manifest, local);

// O CLI envia telemetria anônima para o ranking do skills.sh. Desligada por padrão aqui;
// rode com DISABLE_TELEMETRY=0 se quiser contribuir com o ranking.
const env = { ...process.env, DISABLE_TELEMETRY: process.env.DISABLE_TELEMETRY ?? '1' };

console.log(bold(`\nInstalando skills para: ${manifest.agents.join(', ')}\n`));
for (const command of commands) {
  console.log(`${dim('$')} npx ${command.args.join(' ')}  ${dim(`# ${command.label}`)}`);
  if (values['dry-run']) continue;
  const result = spawnSync('npx', command.args, {
    cwd: project.root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32', // npx é npx.cmd no Windows
  });
  if (result.status !== 0) {
    console.error(red(`\nFalhou: ${command.label}. Veja a saída acima.`));
    process.exit(result.status ?? 1);
  }
}

console.log(green(values['dry-run'] ? '\n(dry-run: nada foi instalado)\n' : '\n✔ skills instaladas. Rode `npm run validate` para conferir.\n'));
