// Leitura dos jobs em disco para a API. A escrita é só da skill scrape-task.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { diskProbe, type Issue } from '../../scripts/lib/files.ts';
import { JOBS_DIR, JOB_FILE, JOB_ID, RESULT_FILE, checkJobDir, type Engine, type Job, type Operation, type ResultStatus, type ScrapeResult, type Shape } from './contract.ts';

export interface JobSummary {
  id: string;
  goal: string | null;
  engine: Engine | null;
  operation: Operation | null;
  shape: Shape | null;
  /**
   * Sem result.json: `running` enquanto um turno do agente trabalha nele,
   * `stopped` se nenhum trabalha mais (parado, travou ou o servidor reiniciou).
   */
  status: ResultStatus | 'running' | 'stopped' | 'invalid';
  items: number;
  /** Primeiro endereço do job (null em buscas), para os próximos passos. */
  source: string | null;
  createdAt: string | null;
}

export interface JobDetail {
  summary: JobSummary;
  job: Job | null;
  result: ScrapeResult | null;
  issues: Issue[];
}

export class JobStore {
  readonly root: string;
  /** Diz se algum turno do agente está trabalhando no job. O servidor liga isto ao ChatStore. */
  isActive: (jobId: string) => boolean = () => false;
  constructor(root: string) {
    this.root = root;
  }

  ids(): string[] {
    try {
      return readdirSync(join(this.root, JOBS_DIR), { withFileTypes: true })
        .filter((d) => d.isDirectory() && JOB_ID.test(d.name))
        .map((d) => d.name)
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  list(): JobSummary[] {
    return this.ids().flatMap((id) => {
      const detail = this.get(id);
      return detail ? [detail.summary] : [];
    });
  }

  /** Qual job criou cada monitor (`result.monitor.id`). */
  monitorJobs(): Map<string, string> {
    const map = new Map<string, string>();
    for (const id of this.ids()) {
      const monitorId = this.get(id)?.result?.monitor?.id;
      if (monitorId && !map.has(monitorId)) map.set(monitorId, id);
    }
    return map;
  }

  hasResult(id: string): boolean {
    return diskProbe(this.root).read(`${JOBS_DIR}/${id}/${RESULT_FILE}`) !== null;
  }

  get(id: string): JobDetail | null {
    if (!JOB_ID.test(id)) return null;
    const probe = diskProbe(this.root);
    const job = parse<Job>(probe.read(`${JOBS_DIR}/${id}/${JOB_FILE}`));
    if (!job && probe.mtimeMs(`${JOBS_DIR}/${id}`) === null) return null;
    const result = parse<ScrapeResult>(probe.read(`${JOBS_DIR}/${id}/${RESULT_FILE}`));
    const issues = checkJobDir(probe, id);
    const invalid = issues.some((i) => i.level === 'error');
    const items = result?.rows?.length ?? result?.documents?.length ?? 0;
    return {
      summary: {
        id,
        goal: job?.goal ?? null,
        engine: job?.engine ?? null,
        operation: job?.operation ?? null,
        shape: job?.shape ?? null,
        status: result ? (invalid ? 'invalid' : result.status) : this.isActive(id) ? 'running' : 'stopped',
        items,
        source: job && job.operation !== 'search' ? (job.targets[0] ?? null) : null,
        createdAt: job?.createdAt ?? null,
      },
      job,
      result,
      issues,
    };
  }
}

function parse<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
