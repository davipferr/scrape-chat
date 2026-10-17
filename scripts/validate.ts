// npm run validate [-- --root <pasta>] [-- --strict]
//
// Confere se todas as skills do skills.json e da pasta skills/ estão instaladas
// e se as locais seguem o padrão Agent Skills.
// Sai com código 1 se houver erro (ou aviso, com --strict).

import { parseArgs } from 'node:util';
import { loadProject, printIssues, green, red, yellow, bold } from './lib/project.ts';
import { listLocalSkillDirs } from './lib/skills.ts';
import { validateProject } from './lib/validate.ts';

const { values } = parseArgs({ options: { root: { type: 'string' }, strict: { type: 'boolean' } } });
const project = loadProject(values.root);
const local = listLocalSkillDirs(project.root);

const issues = [...project.issues];
if (project.manifest) issues.push(...validateProject(project.manifest, local, project.probe));

const errors = issues.filter((i) => i.level === 'error').length;
const warnings = issues.length - errors;
const external = project.manifest?.external.reduce((n, e) => n + e.skills.length, 0) ?? 0;

console.log(bold(`\nValidando skills (${external} externas, ${local.length} locais)\n`));
printIssues(issues);
if (issues.length === 0) console.log(green('  ✔ tudo certo: todas as skills estão no lugar'));
else console.log(`\n  ${errors ? red(`${errors} erro(s)`) : green('0 erros')}, ${warnings ? yellow(`${warnings} aviso(s)`) : '0 avisos'}`);
console.log();

process.exitCode = errors > 0 || (values.strict && warnings > 0) ? 1 : 0;
