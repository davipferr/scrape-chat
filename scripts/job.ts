// npm run job -- new <apelido>        cria data/jobs/<id>/ e imprime o id
// npm run job -- check <id|--latest>  confere job.json (e result.json, se existir)
//
// A skill scrape-task usa os dois: `new` antes de planejar, `check` depois de
// gravar o plano e de novo depois de gravar o resultado.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { diskProbe } from './lib/files.ts';
import { bold, green, printIssues, red } from './lib/project.ts';
import { JOBS_DIR, checkJobDir, createJobDir } from '../src/jobs/contract.ts';

const root = process.cwd();
const [command, arg] = process.argv.slice(2);

function latestJob(): string | undefined {
  try {
    return readdirSync(join(root, JOBS_DIR), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .at(-1);
  } catch {
    return undefined;
  }
}

if (command === 'new' && arg) {
  const id = createJobDir(root, arg);
  console.log(`${JOBS_DIR}/${id}`);
} else if (command === 'check' && arg) {
  const id = arg === '--latest' ? latestJob() : arg.replace(/\\/g, '/').replace(new RegExp(`^${JOBS_DIR}/`), '').replace(/\/$/, '');
  if (!id) {
    console.error(red(`nenhum job em ${JOBS_DIR}/`));
    process.exit(1);
  }
  const issues = checkJobDir(diskProbe(root), id);
  console.log(bold(`\nConferindo ${JOBS_DIR}/${id}\n`));
  printIssues(issues);
  if (issues.length === 0) console.log(green('  ✔ job no formato do contrato'));
  console.log();
  process.exitCode = issues.some((i) => i.level === 'error') ? 1 : 0;
} else {
  console.error('uso: npm run job -- new <apelido> | check <id|--latest>');
  process.exit(2);
}
