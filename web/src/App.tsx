import { useCallback, useEffect, useState } from 'react';
import { api, type ChatSummary, type Health, type JobSummary, type SavedShortcut } from './api.ts';
import { HistoryView, MonitorsView } from './Views.tsx';
import { JobPanel } from './JobPanel.tsx';
import { Composer, ThreadView } from './Thread.tsx';
import { useChat } from './useChat.ts';

const EXAMPLES = [
  'Pegue nome, preço e avaliação de todos os notebooks em https://loja.example/notebooks',
  'Baixe em Markdown as páginas de https://docs.example.com/guia',
  'Monitore https://loja.example/promocoes e me avise quando mudar',
];

type View = 'chat' | 'jobs' | 'monitors';
/** Job aberto ao lado. `chatId` existe quando ele foi aberto pelo histórico. */
type OpenJob = JobSummary & { chatId?: string | null };

function readChatId(): string | null {
  return new URLSearchParams(location.search).get('c');
}

function readView(): View {
  const v = new URLSearchParams(location.search).get('v');
  return v === 'jobs' || v === 'monitors' ? v : 'chat';
}

export function App() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(readChatId);
  const [health, setHealth] = useState<Health | null>(null);
  const [view, setView] = useState<View>(readView);
  const [openJob, setOpenJob] = useState<OpenJob | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [prefill, setPrefill] = useState({ text: '', n: 0 });
  const draft = (text: string) => setPrefill((p) => ({ text, n: p.n + 1 }));
  const [startError, setStartError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedShortcut[]>([]);

  const refreshChats = useCallback(() => void api.chats().then(setChats).catch(() => {}), []);
  const refreshSaved = useCallback(() => void api.shortcuts().then(setSaved).catch(() => {}), []);
  useEffect(() => {
    refreshChats();
    refreshSaved();
    api.health().then(setHealth).catch(() => setHealth(null));
    const onPop = () => {
      setChatId(readChatId());
      setView(readView());
      setOpenJob(null);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [refreshChats, refreshSaved]);

  const onJob = useCallback((job: JobSummary) => {
    // Abre o painel sozinho quando os dados chegam; depois só atualiza o que estiver aberto.
    setOpenJob((current) => (current === null && job.status !== 'running' && job.status !== 'stopped' ? job : current?.id === job.id ? job : current));
  }, []);
  const { thread, error, send, approve, stop } = useChat(chatId, onJob);
  // A lista mostra quais conversas estão respondendo: atualiza quando o turno acaba.
  useEffect(() => {
    if (!thread.running) refreshChats();
  }, [thread.running, refreshChats]);

  const showView = (v: Exclude<View, 'chat'>) => {
    setView(v);
    setOpenJob(null);
    setRailOpen(false);
    history.pushState(null, '', `?v=${v}`);
  };

  const selectChat = (id: string | null) => {
    setView('chat');
    setChatId(id);
    setOpenJob(null);
    setRailOpen(false);
    setPrefill((p) => ({ text: '', n: p.n + 1 }));
    history.pushState(null, '', id ? `?c=${id}` : location.pathname);
  };

  const startWith = async (text: string, fresh = false) => {
    setStartError(null);
    try {
      let id = fresh ? null : chatId;
      if (!id) {
        const chat = await api.createChat();
        id = chat.id;
        selectChat(id);
      }
      await api.send(id, text);
      refreshChats();
    } catch (e) {
      setStartError((e as Error).message);
    }
  };

  // Mensagem enviada antes do chat existir: o useChat ainda não tinha id.
  const onSend = (text: string) => (chatId ? void send(text).then(refreshChats) : void startWith(text));
  const title = chats.find((c) => c.id === chatId)?.title;

  const saveShortcut = async (label: string, text: string) => {
    await api.saveShortcut(label, text);
    refreshSaved();
  };
  // Fora da conversa, as ações do painel do job vão para a conversa de onde o job saiu.
  const askAboutJob = (text: string) => {
    const owner = openJob?.chatId;
    if (!owner) return void startWith(text, true);
    selectChat(owner);
    api.send(owner, text).then(refreshChats, (e: Error) => setStartError(e.message));
  };
  const draftAboutJob = (text: string) => {
    selectChat(openJob?.chatId ?? null);
    draft(text);
  };
  const openJobById = (id: string) => void api.job(id).then((d) => setOpenJob(d.summary), (e: Error) => setStartError(e.message));

  const deleteShortcut = (s: SavedShortcut) => {
    if (!confirm(`Apagar o atalho "${s.label}"?`)) return;
    void api.deleteShortcut(s.id).then(refreshSaved);
  };

  return (
    <div className={`app ${openJob ? 'with-sheet' : ''} ${railOpen ? 'rail-open' : ''}`}>
      <aside className="rail" aria-label="Conversas">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          scrape-chat
        </div>
        <button className="btn btn-primary btn-block" onClick={() => selectChat(null)}>
          Nova conversa
        </button>
        <nav className="rail-nav" aria-label="Telas">
          <button className={`rail-link ${view === 'jobs' ? 'active' : ''}`} aria-current={view === 'jobs' ? 'page' : undefined} onClick={() => showView('jobs')}>
            Histórico de jobs
          </button>
          <button className={`rail-link ${view === 'monitors' ? 'active' : ''}`} aria-current={view === 'monitors' ? 'page' : undefined} onClick={() => showView('monitors')}>
            Monitores
          </button>
        </nav>
        <nav className="chat-list">
          {chats.length === 0 && <p className="rail-empty">Suas conversas ficam aqui.</p>}
          {chats.map((c) => (
            <button key={c.id} className={`chat-link ${view === 'chat' && c.id === chatId ? 'active' : ''}`} onClick={() => selectChat(c.id)} aria-current={view === 'chat' && c.id === chatId ? 'page' : undefined}>
              {c.running && <span className="work-dot" aria-label="respondendo" />}
              <span className="chat-title">{c.title}</span>
            </button>
          ))}
        </nav>
        {saved.length > 0 && (
          <section className="saved" aria-labelledby="saved-title">
            <h2 id="saved-title" className="rail-title">
              Meus atalhos
            </h2>
            <ul>
              {saved.map((s) => (
                <li key={s.id}>
                  <button className="saved-run" title={s.text} onClick={() => void startWith(s.text, true)}>
                    {s.label}
                  </button>
                  <button className="saved-del" aria-label={`Apagar o atalho ${s.label}`} onClick={() => deleteShortcut(s)}>
                    Apagar
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Setup health={health} />
      </aside>
      <button className="rail-scrim" aria-label="Fechar conversas" onClick={() => setRailOpen(false)} tabIndex={railOpen ? 0 : -1} />

      <main className="chat">
        <header className="chat-head">
          <button className="btn btn-quiet menu" onClick={() => setRailOpen(true)} aria-label="Abrir conversas">
            Conversas
          </button>
          <h1>{view === 'jobs' ? 'Histórico de jobs' : view === 'monitors' ? 'Monitores' : chatId ? (title ?? 'Conversa') : 'Nova conversa'}</h1>
          {health && <span className="model">{health.fakeAgent ? 'agente de teste' : health.model}</span>}
        </header>

        {view === 'jobs' && <HistoryView openJobId={openJob?.id ?? null} onOpenJob={setOpenJob} onOpenChat={selectChat} />}
        {view === 'monitors' && (
          <MonitorsView
            onNew={() => {
              selectChat(null);
              draft('Monitore ');
            }}
            onOpenJob={openJobById}
          />
        )}
        {view === 'chat' &&
          (chatId ? (
            <ThreadView thread={thread} onApprove={approve} onOpenJob={setOpenJob} onAsk={onSend} openJobId={openJob?.id ?? null} />
          ) : (
            <Empty onPick={draft} />
          ))}

        {(error || startError) && <p className="notice notice-error composer-error">{error ?? startError}</p>}
        {view === 'chat' && <Composer running={thread.running} disabled={health === null} onSend={onSend} onStop={stop} initial={prefill} />}
      </main>

      {openJob &&
        (view === 'chat' ? (
          <JobPanel job={openJob} onClose={() => setOpenJob(null)} busy={thread.running} onAsk={onSend} onDraft={draft} onSaveShortcut={saveShortcut} onStop={stop} />
        ) : (
          <JobPanel
            job={openJob}
            onClose={() => setOpenJob(null)}
            busy={false}
            onAsk={askAboutJob}
            onDraft={draftAboutJob}
            onSaveShortcut={saveShortcut}
            onStop={openJob.chatId ? () => void api.stop(openJob.chatId!) : undefined}
          />
        ))}
    </div>
  );
}

function Empty({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="empty">
      <h2 className="empty-title">Diga o que você quer de uma página. O resto é com o agente.</h2>
      <p className="empty-lead">Ele escolhe como raspar, roda, confere e devolve uma tabela pronta para baixar. Cole um link no campo abaixo e escolha um atalho, escreva o pedido do seu jeito ou comece por um destes:</p>
      <ul className="examples">
        {EXAMPLES.map((e) => (
          <li key={e}>
            <button className="example" onClick={() => onPick(e)}>
              {e}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Setup({ health }: { health: Health | null }) {
  if (health === null) return <p className="setup setup-error">Servidor desligado. Rode <code>npm run server</code>.</p>;
  if (health.fakeAgent) return <p className="setup">Agente de teste: as respostas são encenadas e nada é raspado.</p>;
  if (!health.keys.scrapegraph) return <p className="setup">Sem <code>SGAI_API_KEY</code> no .env, o agente só usa o navegador local.</p>;
  return null;
}
