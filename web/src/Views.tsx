// As duas telas fora da conversa: o histórico de todos os jobs e os monitores.

import { useEffect, useMemo, useState } from 'react';
import { api, type HistoryJob, type MonitorItem, type MonitorList, type TickView } from './api.ts';
import { STATUS_LABEL, formatCount, formatWhen, humanInterval, shortUrl } from './format.ts';
import { filterRows } from './table.ts';

// ---------- histórico ----------

type StatusFilter = 'all' | 'ok' | 'problem';

export function HistoryView({ openJobId, onOpenJob, onOpenChat }: { openJobId: string | null; onOpenJob: (job: HistoryJob) => void; onOpenChat: (chatId: string) => void }) {
  const [jobs, setJobs] = useState<HistoryJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  useEffect(() => {
    api
      .jobs()
      .then(setJobs)
      .catch((e: Error) => setError(e.message));
  }, []);

  const shown = useMemo(() => {
    const byStatus = (jobs ?? []).filter((j) =>
      status === 'all' ? true : status === 'ok' ? j.status === 'done' || j.status === 'partial' : ['blocked', 'failed', 'invalid'].includes(j.status),
    );
    return filterRows(byStatus as unknown as Record<string, unknown>[], ['goal', 'source', 'id'], query) as unknown as HistoryJob[];
  }, [jobs, query, status]);

  return (
    <div className="view">
      <header className="view-head">
        <p>Tudo o que o agente já raspou, de todas as conversas. Clique num job para abrir os dados.</p>
      </header>
      {error && <p className="notice notice-error">Não deu para carregar o histórico: {error}</p>}
      {jobs && jobs.length > 0 && (
        <div className="toolbar">
          <label className="search">
            <span className="sr-only">Buscar jobs</span>
            <input type="search" placeholder="Buscar por objetivo ou endereço" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label>
            <span className="sr-only">Filtrar por situação</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="all">Todos</option>
              <option value="ok">Com dados</option>
              <option value="problem">Com problema</option>
            </select>
          </label>
        </div>
      )}
      {jobs?.length === 0 && <p className="view-empty">Nenhum job ainda. Peça algo numa conversa e ele aparece aqui.</p>}
      {jobs && jobs.length > 0 && shown.length === 0 && <p className="view-empty">Nenhum job com esse filtro.</p>}
      <ul className="history">
        {shown.map((j) => (
          <li key={j.id} className={openJobId === j.id ? 'active' : undefined}>
            <button className="history-main" onClick={() => onOpenJob(j)} aria-pressed={openJobId === j.id}>
              <span className="history-goal">{j.goal ?? j.id}</span>
              <span className="history-meta">
                <span className={`badge badge-${j.status}`}>{STATUS_LABEL[j.status]}</span>
                {j.status !== 'running' && j.status !== 'stopped' && (
                  <span>
                    {formatCount(j.items)} {j.shape === 'documents' ? (j.items === 1 ? 'página' : 'páginas') : j.items === 1 ? 'linha' : 'linhas'}
                  </span>
                )}
                {j.source && <span>{shortUrl(j.source)}</span>}
                <span>{formatWhen(j.createdAt)}</span>
              </span>
            </button>
            {j.chatId && (
              <button className="link-btn history-chat" onClick={() => onOpenChat(j.chatId!)}>
                Abrir conversa
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- monitores ----------

export function MonitorsView({ onNew, onOpenJob }: { onNew: () => void; onOpenJob: (jobId: string) => void }) {
  const [data, setData] = useState<MonitorList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api
      .monitors()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  const replace = (m: MonitorItem) => setData((d) => d && { ...d, monitors: d.monitors.map((x) => (x.id === m.id ? { ...m, jobId: x.jobId } : x)) });

  return (
    <div className="view">
      <header className="view-head view-head-row">
        <div>
          <p>Páginas que a ScrapeGraph AI confere sozinha. Cada execução gasta créditos, então pause o que não precisa mais.</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>
          Novo monitor
        </button>
      </header>
      {error && <p className="notice notice-error">{error}</p>}
      {data && !data.available && <p className="notice">{data.reason}</p>}
      {data?.available && data.monitors.length === 0 && (
        <p className="view-empty">Nenhum monitor. Cole um link na conversa e use o atalho “Avisar quando mudar”.</p>
      )}
      <ul className="monitors">
        {data?.monitors.map((m) => (
          <MonitorCard
            key={m.id}
            monitor={m}
            onChange={replace}
            onRemoved={() => setData((d) => d && { ...d, monitors: d.monitors.filter((x) => x.id !== m.id) })}
            onError={setError}
            onOpenJob={onOpenJob}
          />
        ))}
      </ul>
    </div>
  );
}

function MonitorCard({
  monitor: m,
  onChange,
  onRemoved,
  onError,
  onOpenJob,
}: {
  monitor: MonitorItem;
  onChange: (m: MonitorItem) => void;
  onRemoved: () => void;
  onError: (message: string) => void;
  onOpenJob: (jobId: string) => void;
}) {
  const [ticks, setTicks] = useState<TickView[] | null>(null);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const act = async (work: () => Promise<void>) => {
    setWorking(true);
    try {
      await work();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const toggleActivity = () => {
    setOpen(!open);
    if (!ticks) void act(async () => setTicks(await api.monitorActivity(m.id)));
  };
  const toggleStatus = () => act(async () => onChange({ ...(m.status === 'active' ? await api.pauseMonitor(m.id) : await api.resumeMonitor(m.id)), jobId: m.jobId }));
  const remove = () => {
    if (!confirm(`Apagar o monitor de ${shortUrl(m.url)}? Ele para de rodar e o histórico de mudanças some da ScrapeGraph.`)) return;
    void act(async () => {
      await api.deleteMonitor(m.id);
      onRemoved();
    });
  };
  const changes = ticks?.filter((t) => t.changed).length ?? 0;

  return (
    <li className={`monitor monitor-${m.status}`}>
      <div className="monitor-head">
        <div>
          <p className="monitor-name">{m.name ?? shortUrl(m.url)}</p>
          <a className="monitor-url" href={m.url} target="_blank" rel="noreferrer noopener">
            {m.url}
          </a>
        </div>
        <span className={`badge ${m.status === 'active' ? 'badge-done' : 'badge-planned'}`}>{m.status === 'active' ? 'Ativo' : 'Pausado'}</span>
      </div>
      <p className="monitor-meta">
        Confere {humanInterval(m.interval)}
        {m.createdAt && <>, criado {formatWhen(m.createdAt)}</>}
      </p>
      <div className="monitor-actions">
        <button className="btn" onClick={toggleActivity} aria-expanded={open}>
          {open ? 'Esconder mudanças' : 'Ver mudanças'}
        </button>
        <button className="btn" onClick={toggleStatus} disabled={working}>
          {m.status === 'active' ? 'Pausar' : 'Retomar'}
        </button>
        {m.jobId && (
          <button className="btn btn-quiet" onClick={() => onOpenJob(m.jobId!)}>
            Ver o job
          </button>
        )}
        <button className="btn btn-quiet monitor-delete" onClick={remove} disabled={working}>
          Apagar
        </button>
      </div>
      {open && (
        <div className="activity">
          {!ticks && <p className="view-empty">Carregando as últimas execuções…</p>}
          {ticks && ticks.length === 0 && <p className="view-empty">Ainda não rodou nenhuma vez.</p>}
          {ticks && ticks.length > 0 && (
            <p className="activity-summary">
              {changes === 0 ? `Nenhuma mudança nas últimas ${ticks.length} execuções.` : `${changes} ${changes === 1 ? 'mudança' : 'mudanças'} nas últimas ${ticks.length} execuções.`}
            </p>
          )}
          <ol className="ticks">
            {ticks?.map((t) => (
              <Tick key={t.id} tick={t} />
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

function Tick({ tick: t }: { tick: TickView }) {
  const label =
    t.status === 'failed' ? 'Falhou' : t.status === 'running' ? 'Rodando' : t.status === 'paused' ? 'Pausado' : t.changed ? `Mudou: +${t.added} −${t.removed} linhas` : 'Sem mudança';
  return (
    <li className={`tick tick-${t.status === 'failed' ? 'failed' : t.changed ? 'changed' : 'same'}`}>
      <span className="tick-when">{formatWhen(t.createdAt)}</span>
      <span className="tick-label">{label}</span>
      {t.lines.length > 0 && (
        <pre className="diff">
          {t.lines.map((l, i) => (
            <span key={i} className={`diff-${l.type}`}>
              {l.type === 'added' ? '+ ' : '− '}
              {l.content}
              {'\n'}
            </span>
          ))}
        </pre>
      )}
    </li>
  );
}
