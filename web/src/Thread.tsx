import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { JobSummary } from './api.ts';
import { Markdown } from './Markdown.tsx';
import type { Thread, ThreadItem, ToolStep } from './thread.ts';
import { STATUS_LABEL, formatCount } from './format.ts';
import { SHORTCUTS, compose, followUps } from './shortcuts.ts';

interface ItemActions {
  onApprove: (approvalId: string, allow: boolean) => void;
  onOpenJob: (job: JobSummary) => void;
  /** Manda uma mensagem pronta para o agente (próximos passos de um job). */
  onAsk: (text: string) => void;
  openJobId: string | null;
  running: boolean;
}

export function ThreadView({ thread, ...actions }: { thread: Thread } & Omit<ItemActions, 'running'>) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [thread.items.length, thread.draft.length > 0]);

  return (
    <div className="thread" aria-live="polite">
      {thread.items.map((item) => (
        <Item key={item.key} item={item} {...actions} running={thread.running} />
      ))}
      {thread.draft && (
        <div className="agent">
          <Markdown text={thread.draft} />
        </div>
      )}
      {thread.running && !thread.draft && !waiting(thread.items.at(-1)) && <p className="thinking">Pensando…</p>}
      <div ref={end} />
    </div>
  );
}

function Item({ item, onApprove, onOpenJob, onAsk, openJobId, running }: { item: ThreadItem } & ItemActions) {
  switch (item.kind) {
    case 'user':
      return <UserMessage text={item.text} />;
    case 'text':
      return (
        <div className="agent">
          <Markdown text={item.text} />
        </div>
      );
    case 'tools':
      return <WorkLog steps={item.steps} />;
    case 'approval':
      return (
        <div className={`approval approval-${item.state}`} role="group" aria-label="Pedido de aprovação">
          <p className="approval-title">{item.state === 'pending' ? 'O agente quer fazer isto' : item.state === 'allowed' ? 'Você permitiu' : 'Não permitido'}</p>
          <p>{capitalize(item.reason)}.</p>
          <code className="cmd">{item.summary}</code>
          {item.state === 'pending' && (
            <div className="approval-actions">
              <button className="btn btn-primary" onClick={() => onApprove(item.approvalId, true)}>
                Permitir
              </button>
              <button className="btn" onClick={() => onApprove(item.approvalId, false)}>
                Não permitir
              </button>
            </div>
          )}
        </div>
      );
    case 'job':
      return <JobCard job={item.job} open={openJobId === item.job.id} onOpen={() => onOpenJob(item.job)} onAsk={running ? null : onAsk} />;
    case 'done':
      if (!item.ok) return <p className="turn-end turn-error">{explainError(item.error)}</p>;
      return (
        <p className="turn-end">
          Concluído em {(item.durationMs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s
          {item.costUsd > 0 && <> e US$ {item.costUsd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} de agente</>}
        </p>
      );
  }
}

/** Mensagem do usuário. Um bloco ```json (vindo do editor de campos) fica recolhido. */
function UserMessage({ text }: { text: string }) {
  const match = /```json\n([\s\S]*?)```/.exec(text);
  if (!match) return <div className="user-msg">{text}</div>;
  return (
    <div className="user-msg">
      {text.slice(0, match.index).trim()}
      <details className="user-code">
        <summary>Schema enviado</summary>
        <pre>{match[1]}</pre>
      </details>
      {text.slice(match.index + match[0].length).trim()}
    </div>
  );
}

const TOOL_VERB: Record<string, string> = { Bash: 'Rodou', Read: 'Leu', Write: 'Gravou', Edit: 'Editou', Glob: 'Procurou', Grep: 'Procurou', WebFetch: 'Abriu', Skill: 'Usou a skill', TodoWrite: 'Planejou' };

function WorkLog({ steps }: { steps: ToolStep[] }) {
  const running = steps.some((s) => s.state === 'running');
  const failed = steps.filter((s) => s.state === 'error').length;
  const [open, setOpen] = useState(false);
  const label = running ? `Trabalhando, passo ${steps.length}` : `${steps.length} ${steps.length === 1 ? 'passo' : 'passos'}${failed ? `, ${failed} com erro` : ''}`;
  return (
    <div className={`work ${running ? 'work-running' : ''}`}>
      <button className="work-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="work-dot" aria-hidden />
        <span className="work-label">{label}</span>
        {!open && running && <span className="work-current">{steps.at(-1)!.summary}</span>}
      </button>
      {open && (
        <ol className="work-steps">
          {steps.map((s) => (
            <li key={s.id} className={`step step-${s.state}`}>
              <span className="step-verb">{TOOL_VERB[s.name] ?? s.name}</span>
              <code className="cmd">{s.summary || s.name}</code>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function JobCard({ job, open, onOpen, onAsk }: { job: JobSummary; open: boolean; onOpen: () => void; onAsk: ((text: string) => void) | null }) {
  const ready = job.status !== 'running' && job.status !== 'stopped';
  const next = onAsk ? followUps(job, job.source) : [];
  return (
    <div className="job">
      <button className={`job-card status-${job.status} ${open ? 'job-card-open' : ''}`} onClick={onOpen} aria-pressed={open}>
        <span className="job-count">
          {ready ? (
            <>
              <mark className="swipe">{formatCount(job.items)}</mark> {job.shape === 'documents' ? (job.items === 1 ? 'página' : 'páginas') : job.items === 1 ? 'linha' : 'linhas'}
            </>
          ) : job.status === 'stopped' ? (
            'Parou antes de terminar'
          ) : (
            'Preparando…'
          )}
        </span>
        <span className="job-goal">{job.goal ?? job.id}</span>
        <span className="job-meta">
          <span className={`badge badge-${job.status}`}>{STATUS_LABEL[job.status]}</span>
          <span>{job.engine === 'browser' ? 'navegador' : 'ScrapeGraph'}</span>
          <span className="job-open">{open ? 'Aberto ao lado' : 'Ver dados'}</span>
        </span>
      </button>
      {next.length > 0 && (
        <div className="next" aria-label="Próximos passos">
          {next.map((f) => (
            <button key={f.id} className="chip" onClick={() => onAsk!(f.message)}>
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Composer({ running, disabled, onSend, onStop, initial }: { running: boolean; disabled: boolean; onSend: (text: string) => void; onStop: () => void; initial: { text: string; n: number } }) {
  const [text, setText] = useState(initial.text);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setText(initial.text);
    const el = area.current;
    if (initial.text && el) {
      el.focus();
      el.setSelectionRange(initial.text.length, initial.text.length);
    }
  }, [initial.n]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => setHint(null), [text]);
  const useShortcut = (id: string) => {
    const shortcut = SHORTCUTS.find((s) => s.id === id)!;
    const result = compose(shortcut, text);
    if (!result.ok) {
      setHint(result.reason);
      area.current?.focus();
      return;
    }
    onSend(result.message);
    setText('');
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || running || disabled) return;
    onSend(text.trim());
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  return (
    <div className="composer-wrap">
      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="pedido">
          O que você quer extrair
        </label>
        <textarea
          id="pedido"
          ref={area}
          rows={1}
          value={text}
          placeholder="Cole um link e diga o que quer dele"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={disabled}
        />
        {running ? (
          <button type="button" className="btn" onClick={onStop}>
            Parar
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!text.trim() || disabled}>
            Enviar
          </button>
        )}
      </form>
      <div className="shortcuts" role="group" aria-label="Atalhos: cole um link no campo e clique">
        {SHORTCUTS.map((s) => (
          <button key={s.id} type="button" className="chip" title={s.hint} disabled={running || disabled} onClick={() => useShortcut(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="shortcut-hint" role="status">
        {hint}
      </p>
    </div>
  );
}

/** O último item já mostra que algo está acontecendo (passos rodando ou aprovação pendente). */
function waiting(item: ThreadItem | undefined): boolean {
  return item?.kind === 'tools' || (item?.kind === 'approval' && item.state === 'pending');
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function explainError(error?: string): string {
  if (!error) return 'O agente parou sem terminar.';
  if (/oauth|authenticat|api key|401/i.test(error)) return 'O agente não conseguiu entrar na sua conta Claude. Num terminal, rode npx @anthropic-ai/claude-code, digite /login e depois /exit, e reinicie o servidor. Ou preencha ANTHROPIC_API_KEY no .env.';
  if (error === 'interrompido') return 'Você interrompeu esta resposta.';
  return `O agente parou: ${error}`;
}
