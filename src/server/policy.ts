// O que o agente do chat pode fazer sem perguntar, o que precisa do "sim" do
// usuário e o que nunca roda. É a cerca em volta das skills: elas pedem, esta
// política decide. Função pura, sem I/O, para ser testada linha a linha.

import { isAbsolute, relative, resolve } from 'node:path';

export type Decision = { kind: 'allow' } | { kind: 'ask'; reason: string } | { kind: 'deny'; reason: string };

const allow: Decision = { kind: 'allow' };
const deny = (reason: string): Decision => ({ kind: 'deny', reason });
const ask = (reason: string): Decision => ({ kind: 'ask', reason });

/** Ferramentas do Claude Code que o agente recebe. O resto nem aparece para ele. */
export const AGENT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'TodoWrite'];
/** Só as skills de runtime: as de dev (find-skills, frontend-design) ficam de fora. */
export const AGENT_SKILLS = ['scrape-task', 'just-scrape', 'browser'];

const WRITABLE = 'data/jobs';
const READ_ONLY_COMMANDS = new Set(['jq', 'head', 'tail', 'wc', 'cat', 'ls', 'grep', 'rg', 'sort', 'uniq', 'echo', 'test', 'true']);
const MAX_PAGES_WITHOUT_ASKING = 50;

export function decide(tool: string, input: Record<string, unknown>, root: string): Decision {
  switch (tool) {
    case 'Read':
    case 'Glob':
    case 'Grep': {
      const path = String(input.file_path ?? input.path ?? '.');
      if (isSecretPath(path)) return deny('arquivos .env guardam chaves e não são lidos pelo agente');
      return inside(root, path) ? allow : deny(`fora da pasta do projeto: ${path}`);
    }
    case 'Write':
    case 'Edit': {
      const path = String(input.file_path ?? '');
      return inside(resolve(root, WRITABLE), resolve(root, path)) ? allow : deny(`o agente só grava em ${WRITABLE}/ (pediu ${path})`);
    }
    case 'Bash':
      return decideBash(String(input.command ?? ''));
    case 'WebFetch':
    case 'TodoWrite':
    case 'Skill':
      return allow;
    default:
      return deny(`ferramenta não liberada no scrape-chat: ${tool}`);
  }
}

export function decideBash(command: string): Decision {
  if (/`|\$\(|<\(/.test(command)) return deny('substituição de comando (`...`, $(...)) não é permitida');
  const segments = splitCommands(command);
  if (segments === null) return deny('aspas sem fechar no comando');
  let pending: Decision | null = null;
  for (const words of segments) {
    if (words.length === 0) continue;
    const decision = decideSegment(words);
    if (decision.kind === 'deny') return decision;
    if (decision.kind === 'ask') pending ??= decision;
  }
  return pending ?? allow;
}

function decideSegment(words: string[]): Decision {
  const { args, redirects } = splitRedirects(words);
  for (const target of redirects) {
    if (target === '/dev/null' || /^&\d$/.test(target)) continue;
    if (!target.startsWith(`${WRITABLE}/`) || target.includes('..')) return deny(`saída redirecionada para fora de ${WRITABLE}/: ${target}`);
  }
  for (const a of args) if (isSecretPath(a)) return deny('arquivos .env guardam chaves e não são lidos pelo agente');

  const [cmd, sub, third] = args;
  if (cmd === 'npx' && (sub === 'just-scrape' || sub === 'browse')) return decideEngine(sub, args.slice(2));
  if (cmd === 'npm' && sub === 'run' && (third === 'job' || (third === '--silent' && args[3] === 'job'))) return allow;
  if (cmd === 'mkdir' && args.slice(1).every((a) => a === '-p' || a.startsWith(`${WRITABLE}/`))) return allow;
  if (cmd && READ_ONLY_COMMANDS.has(cmd)) {
    const outside = args.slice(1).find((a) => !a.startsWith('-') && looksLikePath(a) && !isProjectRelative(a));
    return outside ? deny(`caminho fora do projeto: ${outside}`) : allow;
  }
  return deny(`comando não liberado: ${args.slice(0, 2).join(' ')}. Use npx just-scrape, npx browse ou npm run job`);
}

function decideEngine(engine: 'just-scrape' | 'browse', args: string[]): Decision {
  if (args.includes('-g') || args.includes('--global')) return deny('nada é instalado global; os CLIs já estão no projeto');
  if (args.includes('--stealth')) return deny('--stealth contorna bloqueio anti-bot; grave status "blocked" no job');
  if (engine === 'browse') {
    if (args.includes('--remote')) return deny('--remote (Browserbase com CAPTCHA e proxies) está desligado; use --local');
    if (args.includes('--cdp')) return deny('--cdp não é usado; use --local ou --auto-connect');
    if (args[0] === 'open' && args.includes('--auto-connect')) return ask('abrir o seu Chrome já logado (--auto-connect)');
    return allow;
  }
  const [command, sub] = args;
  if (command === 'monitor' && (sub === 'create' || sub === 'update' || sub === 'delete' || sub === 'resume')) {
    return ask(`monitor ${sub}: um monitor gasta créditos a cada execução, sem prazo para acabar`);
  }
  if (command === 'crawl') {
    const max = Number(flagValue(args, '--max-pages'));
    if (!Number.isFinite(max) || max <= 0) return ask('crawl sem --max-pages pode raspar o site inteiro');
    if (max > MAX_PAGES_WITHOUT_ASKING) return ask(`crawl de até ${max} páginas`);
  }
  return allow;
}

/**
 * Quebra um comando de shell em segmentos (`&&`, `||`, `;`, `|`, quebra de linha),
 * cada um uma lista de palavras sem as aspas. `null` se houver aspas sem fechar.
 */
export function splitCommands(command: string): string[][] | null {
  const segments: string[][] = [[]];
  let word = '';
  let hasWord = false;
  let quote: '"' | "'" | null = null;
  const push = () => {
    if (hasWord) segments.at(-1)!.push(word);
    word = '';
    hasWord = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      hasWord = true;
    } else if (c === '\\' && i + 1 < command.length) {
      word += command[++i];
      hasWord = true;
    } else if (c === ' ' || c === '\t') push();
    else if (c === '\n' || c === ';' || c === '|' || (c === '&' && command[i + 1] === '&')) {
      push();
      if ((c === '|' || c === '&') && command[i + 1] === c) i++;
      segments.push([]);
    } else if (c === '&' && command[i - 1] !== '>' && command[i + 1] !== '>') {
      push();
      segments.push([]);
    } else {
      word += c;
      hasWord = true;
    }
  }
  if (quote) return null;
  push();
  return segments.filter((s) => s.length > 0);
}

/** Separa `> arquivo`, `>> arquivo`, `2>&1` das palavras do comando. */
function splitRedirects(words: string[]): { args: string[]; redirects: string[] } {
  const args: string[] = [];
  const redirects: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const m = /^(\d?)(>>?)(.*)$/.exec(w);
    if (!m) {
      args.push(w);
      continue;
    }
    const target = m[3] || words[++i] || '';
    redirects.push(target);
  }
  return { args, redirects };
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i >= 0) return args[i + 1];
  return args.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);
}

function isSecretPath(p: string): boolean {
  const base = p.split(/[\\/]/).at(-1) ?? '';
  return base === '.env' || (base.startsWith('.env.') && base !== '.env.example');
}
const looksLikePath = (a: string) => a.includes('/') || a.includes('\\') || a.startsWith('.') || a.startsWith('~');
const isProjectRelative = (a: string) => !isAbsolute(a) && !a.startsWith('~') && !/^[A-Za-z]:/.test(a) && !a.split(/[\\/]/).includes('..');

function inside(dir: string, path: string): boolean {
  const rel = relative(resolve(dir), resolve(dir, path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
