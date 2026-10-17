import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, openStream, type ChatEvent, type JobSummary } from './api.ts';
import { buildThread } from './thread.ts';

/** Estado de uma conversa aberta: eventos salvos + SSE ao vivo. */
export function useChat(chatId: string | null, onJob: (job: JobSummary) => void) {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onJobRef = useRef(onJob);
  onJobRef.current = onJob;

  useEffect(() => {
    setEvents([]);
    setDraft('');
    setError(null);
    if (!chatId) return;
    let close = () => {};
    let cancelled = false;
    api
      .chat(chatId)
      .then((chat) => {
        if (cancelled) return;
        setEvents(chat.events);
        close = openStream(chatId, chat.events.at(-1)?.seq ?? 0, (event) => {
          if (event.type === 'text-delta') {
            setDraft((d) => d + event.text);
            return;
          }
          if (event.type === 'text' || event.type === 'tool' || event.type === 'done') setDraft('');
          if (event.type === 'job') onJobRef.current(event.job);
          // O EventSource pode reenviar eventos ao reconectar: ignora o que já temos.
          setEvents((list) => (list.length && event.seq <= list.at(-1)!.seq ? list : [...list, event]));
        });
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      close();
    };
  }, [chatId]);

  const thread = useMemo(() => buildThread(events, draft), [events, draft]);

  const send = useCallback(
    async (text: string) => {
      if (!chatId) return;
      setError(null);
      await api.send(chatId, text).catch((e: Error) => setError(e.message));
    },
    [chatId],
  );
  const approve = useCallback(
    (approvalId: string, allow: boolean) => {
      if (chatId) void api.approve(chatId, approvalId, allow).catch((e: Error) => setError(e.message));
    },
    [chatId],
  );
  const stop = useCallback(() => {
    if (chatId) void api.stop(chatId);
  }, [chatId]);

  return { thread, error, send, approve, stop };
}
