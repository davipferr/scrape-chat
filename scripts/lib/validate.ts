import { error, warning, type FileProbe, type Issue } from './files.ts';
import { LOCAL_SKILLS_DIR, MANIFEST_FILE, checkSkill, readInstalled, readLocalSkill, type Manifest } from './skills.ts';

/**
 * Confere se as skills estão no lugar: as locais seguem o padrão Agent Skills,
 * e tudo o que o skills.json e a pasta skills/ pedem está instalado.
 * Erros: o agente vai falhar. Avisos: a cópia instalada ficou para trás.
 */
export function validateProject(manifest: Manifest, localDirs: string[], probe: FileProbe): Issue[] {
  const issues: Issue[] = [];

  for (const dir of localDirs) {
    const skill = readLocalSkill(probe, dir);
    if (skill === null) {
      issues.push(error(`${LOCAL_SKILLS_DIR}/${dir}`, 'pasta sem SKILL.md'));
      continue;
    }
    issues.push(...checkSkill(skill));
    const installed = readInstalled(probe, dir);
    if (installed === null) issues.push(error(`${LOCAL_SKILLS_DIR}/${dir}`, 'skill local não instalada: rode `npm run setup`'));
    else if (installed !== skill.text) {
      issues.push(warning(`${LOCAL_SKILLS_DIR}/${dir}`, 'a cópia instalada está diferente do original: rode `npm run setup`'));
    }
  }

  const seen = new Map<string, string>();
  for (const entry of manifest.external) {
    for (const name of entry.skills) {
      const where = `${MANIFEST_FILE} › ${entry.source}@${name}`;
      const other = seen.get(name);
      if (other) issues.push(error(where, `nome repetido: \`${name}\` também vem de ${other}`));
      seen.set(name, entry.source);
      if (localDirs.includes(name)) issues.push(error(where, `conflita com a skill local ${LOCAL_SKILLS_DIR}/${name}`));
      if (readInstalled(probe, name) === null) issues.push(error(where, 'não instalada: rode `npm run setup`'));
    }
  }

  return issues;
}
