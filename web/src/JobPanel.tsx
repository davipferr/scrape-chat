import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, type JobDetail, type JobSummary } from './api.ts';
import { STATUS_LABEL, formatCell, formatCount, shortUrl } from './format.ts';
import { Markdown } from './Markdown.tsx';
import {
  FIELD_TYPES,
  fieldName,
  fieldsToSchema,
  filterRows,
  schemaToFields,
  sortRows,
  toCsv,
  toJson,
  type CsvFlavor,
  type Field,
  type Row,
  type SortDir,
} from './table.ts';

type Job = NonNullable<JobDetail['job']>;
type Result = NonNullable<JobDetail['result']>;
type Tab = 'data' | 'fields' | 'details';

const PAGE = 200;

interface PanelProps {
  job: JobSummary;
  onClose: () => void;
  /** O agente está ocupado nesta conversa: ações que mandam mensagem esperam. */
  busy: boolean;
  /** Manda uma mensagem pronta para o agente. */
  onAsk: (text: string) => void;
  /** Coloca um texto no campo de mensagem para o usuário completar. */
  onDraft: (text: string) => void;
  /** Guarda o pedido do job como atalho na barra lateral. */
  onSaveShortcut: (label: string, text: string) => Promise<void>;
  /** Para o turno do agente que está trabalhando neste job. */
  onStop?: () => void;
}

/** O job aberto ao lado do chat: dados, campos e o que foi feito. */
export function JobPanel({ job, onClose, busy, onAsk, onDraft, onSaveShortcut, onStop }: PanelProps) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('data');
  const version = `${job.id}:${job.status}:${job.items}`;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .job(job.id)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [version]);
  useEffect(() => setTab('data'), [job.id]);

  const current = detail?.summary.id === job.id ? detail : null;
  const spec = current?.job ?? null;
  const result = current?.result ?? null;
  const isTable = (spec?.shape ?? job.shape) === 'table';
  const tabs: [Tab, string][] = [['data', isTable ? 'Dados' : 'Páginas'], ...(isTable && spec ? [['fields', 'Campos'] as [Tab, string]] : []), ['details', 'Como foi feito']];

  return (
    <section className="sheet" aria-label="Dados do job">
      <header className="sheet-head">
        <div>
          <span className={`badge badge-${job.status}`}>{STATUS_LABEL[job.status]}</span>
          <h2>{job.goal ?? job.id}</h2>
          {result && result.sources.length > 0 && (
            <p className="sheet-sources">
              De{' '}
              {result.sources.slice(0, 3).map((s, i) => (
                <span key={s}>
                  {i > 0 && ', '}
                  <a href={s} target="_blank" rel="noreferrer noopener">
                    {shortUrl(s)}
                  </a>
                </span>
              ))}
              {result.sources.length > 3 && ` e mais ${result.sources.length - 3}`}
            </p>
          )}
        </div>
        <div className="sheet-actions">
          {job.status === 'running' && onStop && (
            <button className="btn" onClick={onStop}>
              Parar
            </button>
          )}
          <button className="btn btn-quiet" onClick={onClose} aria-label="Fechar dados do job">
            Fechar
          </button>
        </div>
      </header>
      {job.status === 'stopped' && <p className="notice">Este job parou antes de terminar: foi interrompido, o agente travou ou o servidor reiniciou no meio. Use “Tentar de novo” embaixo do job na conversa, ou peça de novo.</p>}

      {spec && <SaveShortcut key={spec.id} label={spec.goal} text={spec.request} onSave={onSaveShortcut} />}

      <div className="tabs" role="tablist" aria-label="Partes do job">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`pane-${id}`} className="tab" onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="pane" role="tabpanel" id={`pane-${tab}`} aria-labelledby={`tab-${tab}`}>
        {error && <p className="notice notice-error">Não deu para abrir este job: {error}</p>}
        {tab === 'data' && (
          <>
            {spec && spec.assumptions.length > 0 && <Assumptions spec={spec} onDraft={onDraft} />}
            {job.status !== 'stopped' && <Problems detail={current} />}
            {!result && !error && job.status === 'running' && <p className="sheet-empty">Os dados aparecem aqui quando o agente terminar a extração.</p>}
            {result?.rows && result.columns && <DataView jobId={job.id} columns={result.columns} rows={result.rows} />}
            {result?.documents && <DocsView jobId={job.id} documents={result.documents} />}
          </>
        )}
        {tab === 'fields' && spec && <FieldsEditor spec={spec} busy={busy} onAsk={onAsk} />}
        {tab === 'details' && <Details spec={spec} result={result} />}
      </div>

      <footer className="sheet-foot">
        Arquivos em <code>data/jobs/{job.id}/</code>
      </footer>
    </section>
  );
}

/** "Salvar como atalho": o pedido original vira um botão na barra lateral. */
function SaveShortcut({ label, text, onSave }: { label: string; text: string; onSave: (label: string, text: string) => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'editing' | 'saved'>('idle');
  const [name, setName] = useState(label.slice(0, 60));
  const [error, setError] = useState<string | null>(null);
  if (state === 'saved') return <p className="save-note">Salvo em Meus atalhos. Um clique lá repete este pedido numa conversa nova.</p>;
  if (state === 'idle')
    return (
      <button className="link-btn save-open" onClick={() => setState('editing')}>
        Salvar como atalho
      </button>
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onSave(name, text);
      setState('saved');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="save-form" onSubmit={submit}>
      <label>
        <span className="field-label">Nome do atalho</span>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
        Salvar
      </button>
      <button className="btn btn-quiet" type="button" onClick={() => setState('idle')}>
        Cancelar
      </button>
      {error && <p className="notice notice-error">{error}</p>}
    </form>
  );
}

function Assumptions({ spec, onDraft }: { spec: Job; onDraft: (text: string) => void }) {
  return (
    <div className="assumptions">
      <p className="assumptions-title">Decidido sem perguntar</p>
      <ul>
        {spec.assumptions.map((a) => (
          <li key={a}>
            <span>{a}</span>
            <button className="link-btn" onClick={() => onDraft(`No job "${spec.goal}", em vez de "${a}", `)}>
              Mudar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Problems({ detail }: { detail: JobDetail | null }) {
  const result = detail?.result;
  const problems = detail?.issues.filter((i) => i.level === 'error') ?? [];
  return (
    <>
      {result?.error && <p className="notice notice-error">{result.error}</p>}
      {result && result.warnings.length > 0 && (
        <ul className="notice">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <p className="notice notice-error">
          O resultado não passou na conferência do contrato: {problems[0]!.message}
          {problems.length > 1 && ` (e mais ${problems.length - 1})`}
        </p>
      )}
    </>
  );
}

// ---------- dados ----------

function DataView({ jobId, columns, rows }: { jobId: string; columns: string[]; rows: Row[] }) {
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ column: string; dir: SortDir } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [openRow, setOpenRow] = useState<Row | null>(null);
  useEffect(() => {
    setQuery('');
    setHidden(new Set());
    setSort(null);
    setLimit(PAGE);
  }, [jobId]);

  const visibleColumns = columns.filter((c) => !hidden.has(c));
  const view = useMemo(() => {
    const filtered = filterRows(rows, visibleColumns, query);
    return sort ? sortRows(filtered, sort.column, sort.dir) : filtered;
  }, [rows, visibleColumns.join('\u0000'), query, sort]);
  const numeric = visibleColumns.map((c) => rows.every((r) => r[c] == null || typeof r[c] === 'number'));

  const toggleSort = (column: string) =>
    setSort((s) => (s?.column !== column ? { column, dir: 'asc' } : s.dir === 'asc' ? { column, dir: 'desc' } : null));

  const exportAs = (kind: CsvFlavor | 'json') => {
    const body = kind === 'json' ? toJson(visibleColumns, view) : toCsv(visibleColumns, view, kind);
    download(`${jobId}${kind === 'excel' ? '-excel' : ''}.${kind === 'json' ? 'json' : 'csv'}`, body, kind === 'json' ? 'application/json' : 'text/csv');
  };

  return (
    <div className="data">
      <div className="toolbar">
        <label className="search">
          <span className="sr-only">Buscar nas linhas</span>
          <input type="search" placeholder="Buscar nas linhas" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Popover label={`Colunas${hidden.size ? ` (${visibleColumns.length}/${columns.length})` : ''}`}>
          {columns.map((c) => (
            <label key={c} className="check">
              <input
                type="checkbox"
                checked={!hidden.has(c)}
                disabled={!hidden.has(c) && visibleColumns.length === 1}
                onChange={() =>
                  setHidden((h) => {
                    const next = new Set(h);
                    if (next.has(c)) next.delete(c);
                    else next.add(c);
                    return next;
                  })
                }
              />
              {c.replace(/_/g, ' ')}
            </label>
          ))}
        </Popover>
        <Popover label="Baixar" align="end">
          <p className="pop-note">
            {view.length === rows.length ? `Todas as ${formatCount(rows.length)} linhas` : `As ${formatCount(view.length)} linhas da busca`}, {visibleColumns.length === columns.length ? 'todas as colunas' : `${visibleColumns.length} colunas`}.
          </p>
          <button className="pop-item" onClick={() => exportAs('csv')}>
            CSV
          </button>
          <button className="pop-item" onClick={() => exportAs('excel')}>
            CSV para Excel
          </button>
          <button className="pop-item" onClick={() => exportAs('json')}>
            JSON
          </button>
        </Popover>
      </div>

      <p className="data-count" aria-live="polite">
        {view.length === rows.length ? `${formatCount(rows.length)} linhas` : `${formatCount(view.length)} de ${formatCount(rows.length)} linhas`}
      </p>

      <div className="data-scroll" tabIndex={0} role="region" aria-label="Tabela de dados extraídos">
        <table>
          <thead>
            <tr>
              {visibleColumns.map((c, i) => (
                <th key={c} className={numeric[i] ? 'num' : undefined} scope="col" aria-sort={sort?.column === c ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button className="th-btn" onClick={() => toggleSort(c)}>
                    <span className="marker">{c.replace(/_/g, ' ')}</span>
                    <span className="sort-mark" aria-hidden>
                      {sort?.column === c ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.slice(0, limit).map((row, r) => (
              <tr key={r} onClick={() => setOpenRow(row)} className="row-link">
                {visibleColumns.map((c, ci) => {
                  const cell = formatCell(row[c]);
                  return (
                    <td key={c} className={[cell.numeric && 'num', cell.empty && 'blank'].filter(Boolean).join(' ') || undefined}>
                      {ci === 0 ? (
                        <button className="row-btn" onClick={(e) => (e.stopPropagation(), setOpenRow(row))} aria-label={`Ver a linha ${r + 1} inteira`}>
                          {cell.url ? shortUrl(cell.text) : cell.text}
                        </button>
                      ) : cell.url ? (
                        <a href={cell.text} target="_blank" rel="noreferrer noopener" title={cell.text} onClick={(e) => e.stopPropagation()}>
                          {shortUrl(cell.text)}
                        </a>
                      ) : (
                        cell.text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {view.length === 0 && <p className="sheet-empty table-empty">Nenhuma linha com “{query}”.</p>}
      </div>
      {view.length > limit && (
        <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
          Mostrar mais {formatCount(Math.min(PAGE, view.length - limit))} linhas
        </button>
      )}
      <RowDialog row={openRow} columns={columns} onClose={() => setOpenRow(null)} />
    </div>
  );
}

function RowDialog({ row, columns, onClose }: { row: Row | null; columns: string[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (row && !dialog.open) dialog.showModal();
    if (!row && dialog.open) dialog.close();
  }, [row]);
  return (
    <dialog ref={ref} className="row-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label="Linha inteira">
      {row && (
        <>
          <dl>
            {columns.map((c) => {
              const cell = formatCell(row[c]);
              return (
                <div key={c}>
                  <dt>{c.replace(/_/g, ' ')}</dt>
                  <dd className={cell.empty ? 'blank' : undefined}>
                    {cell.url ? (
                      <a href={cell.text} target="_blank" rel="noreferrer noopener">
                        {cell.text}
                      </a>
                    ) : (
                      cell.text
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          <div className="dialog-actions">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(JSON.stringify(row, null, 2))}>
              Copiar como JSON
            </button>
            <button className="btn btn-primary" onClick={onClose} autoFocus>
              Fechar
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

// ---------- páginas (jobs de documentos) ----------

function DocsView({ jobId, documents }: { jobId: string; documents: Result['documents'] & object }) {
  const [open, setOpen] = useState(0);
  useEffect(() => setOpen(0), [jobId]);
  const doc = documents[open];
  const exportAs = (kind: 'md' | 'json') => {
    const body = kind === 'json' ? JSON.stringify(documents, null, 2) : documents.map((d) => `<!-- ${d.url} -->\n\n${d.markdown.trim()}\n`).join('\n---\n\n');
    download(`${jobId}.${kind}`, body, kind === 'json' ? 'application/json' : 'text/markdown');
  };
  return (
    <div className="docs">
      <div className="toolbar">
        <p className="data-count">
          {formatCount(documents.length)} {documents.length === 1 ? 'página' : 'páginas'}
        </p>
        <Popover label="Baixar" align="end">
          <button className="pop-item" onClick={() => exportAs('md')}>
            Markdown, tudo num arquivo
          </button>
          <button className="pop-item" onClick={() => exportAs('json')}>
            JSON
          </button>
        </Popover>
      </div>
      {documents.length > 1 && (
        <ol className="doc-list">
          {documents.map((d, i) => (
            <li key={d.url}>
              <button className={`doc-link ${i === open ? 'active' : ''}`} aria-current={i === open} onClick={() => setOpen(i)}>
                {d.title || shortUrl(d.url)}
              </button>
            </li>
          ))}
        </ol>
      )}
      {doc && (
        <article className="reader">
          <a className="reader-url" href={doc.url} target="_blank" rel="noreferrer noopener">
            {shortUrl(doc.url)}
          </a>
          <Markdown text={doc.markdown} />
        </article>
      )}
    </div>
  );
}

// ---------- campos (editor de schema) ----------

function FieldsEditor({ spec, busy, onAsk }: { spec: Job; busy: boolean; onAsk: (text: string) => void }) {
  const original = useMemo(() => schemaToFields(spec.schema), [spec.id]);
  const [fields, setFields] = useState<Field[]>(original);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    setFields(original);
    setSent(false);
  }, [original]);

  const update = (i: number, patch: Partial<Field>) => setFields((fs) => fs.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const names = fields.map((f) => fieldName(f.name));
  const duplicate = names.find((n, i) => n && names.indexOf(n) !== i);
  const changed = JSON.stringify(fields) !== JSON.stringify(original);
  const valid = names.some(Boolean) && !duplicate;

  const redo = () => {
    const schema = JSON.stringify(fieldsToSchema(fields));
    onAsk(`Refaça o job ${spec.id} ("${spec.goal}") com estes campos. Crie um job novo com o mesmo alvo e as mesmas opções, e use exatamente este schema:\n\n\`\`\`json\n${schema}\n\`\`\``);
    setSent(true);
  };

  return (
    <div className="fields">
      <p className="fields-lead">Estes são os campos que o agente extraiu. Mude, tire ou acrescente e peça para refazer: ele cria um job novo, o atual continua salvo.</p>
      <ol className="field-list">
        {fields.map((f, i) => (
          <li key={i} className="field">
            <label>
              <span className="field-label">Nome</span>
              <input value={f.name} onChange={(e) => update(i, { name: e.target.value })} aria-invalid={Boolean(duplicate && names[i] === duplicate)} />
            </label>
            <label>
              <span className="field-label">Tipo</span>
              <select value={f.type} onChange={(e) => update(i, { type: e.target.value as Field['type'] })}>
                {FIELD_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="field-wide">
              <span className="field-label">O que é (ajuda o agente a achar)</span>
              <input value={f.description} placeholder="opcional" onChange={(e) => update(i, { description: e.target.value })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} />
              Obrigatório
            </label>
            <button className="link-btn field-remove" onClick={() => setFields((fs) => fs.filter((_, k) => k !== i))} aria-label={`Tirar o campo ${f.name || i + 1}`}>
              Tirar
            </button>
          </li>
        ))}
      </ol>
      {duplicate && <p className="notice notice-error">Dois campos viram “{duplicate}”. Dê nomes diferentes.</p>}
      <div className="fields-actions">
        <button className="btn" onClick={() => setFields((fs) => [...fs, { name: '', type: 'texto', description: '', required: false }])}>
          Acrescentar campo
        </button>
        <button className="btn btn-quiet" disabled={!changed} onClick={() => setFields(original)}>
          Desfazer mudanças
        </button>
        <button className="btn btn-primary" disabled={!changed || !valid || busy || sent} onClick={redo}>
          {sent ? 'Pedido enviado' : 'Refazer com estes campos'}
        </button>
      </div>
      {busy && changed && !sent && <p className="pop-note">Espere o agente terminar a resposta atual para pedir de novo.</p>}
    </div>
  );
}

// ---------- como foi feito ----------

const OPERATION: Record<string, string> = {
  search: 'busca na web',
  scrape: 'leitura da página',
  extract: 'extração com IA',
  crawl: 'varredura de várias páginas',
  monitor: 'monitor de mudanças',
  browse: 'navegador local',
};

function Details({ spec, result }: { spec: Job | null; result: Result | null }) {
  if (!spec) return <p className="sheet-empty">O plano do job ainda não foi gravado.</p>;
  return (
    <dl className="details">
      <div>
        <dt>Pedido</dt>
        <dd>{spec.request}</dd>
      </div>
      <div>
        <dt>Como</dt>
        <dd>
          {OPERATION[spec.operation] ?? spec.operation} com {spec.engine === 'browser' ? 'o navegador' : 'ScrapeGraph AI'}
        </dd>
      </div>
      <div>
        <dt>{spec.operation === 'search' ? 'Busca' : spec.targets.length === 1 ? 'Endereço' : 'Endereços'}</dt>
        <dd>
          <ul className="plain">
            {spec.targets.map((t) => (
              <li key={t}>
                {/^https?:\/\//.test(t) ? (
                  <a href={t} target="_blank" rel="noreferrer noopener">
                    {t}
                  </a>
                ) : (
                  t
                )}
              </li>
            ))}
          </ul>
        </dd>
      </div>
      {spec.prompt && (
        <div>
          <dt>Instrução de extração</dt>
          <dd>{spec.prompt}</dd>
        </div>
      )}
      {Object.keys(spec.options).length > 0 && (
        <div>
          <dt>Opções</dt>
          <dd>
            <code className="cmd block">{JSON.stringify(spec.options)}</code>
          </dd>
        </div>
      )}
      {result && (
        <div>
          <dt>Comandos que rodaram</dt>
          <dd>
            {result.commands.map((c, i) => (
              <code key={i} className="cmd block">
                {c}
              </code>
            ))}
          </dd>
        </div>
      )}
      {result && (
        <div>
          <dt>Terminou</dt>
          <dd>{new Date(result.finishedAt).toLocaleString('pt-BR')}</dd>
        </div>
      )}
    </dl>
  );
}

// ---------- utilidades ----------

function Popover({ label, align = 'start', children }: { label: string; align?: 'start' | 'end'; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return (
    <details className={`pop pop-${align}`} ref={ref}>
      <summary className="btn">{label}</summary>
      <div className="pop-body">{children}</div>
    </details>
  );
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
