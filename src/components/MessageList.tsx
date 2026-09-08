import { useEffect, useLayoutEffect, useRef } from 'react';
import type { DisplayMessage } from '../hooks/useMessages';

interface MessageListProps {
  messages: DisplayMessage[];
  loading: boolean;
  loadingOlder: boolean;
  reachedStart: boolean;
  onLoadOlder: () => void;
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

/** How far from the bottom still counts as "following along". */
const STICK_TO_BOTTOM_PX = 80;

/** How close to the top starts fetching the previous page. */
const LOAD_OLDER_PX = 120;

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

export function MessageList({
  messages,
  loading,
  loadingOlder,
  reachedStart,
  onLoadOlder,
  onRetry,
  onDismiss,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  /**
   * The scroll height from just before a page of older messages was asked
   * for. Restoring the difference afterwards is what keeps the line you were
   * reading under your eyes instead of throwing it down the page.
   */
  const heightBeforeOlder = useRef<number | null>(null);
  const previousCount = useRef(0);

  function handleScroll(): void {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distance < STICK_TO_BOTTOM_PX;

    if (element.scrollTop < LOAD_OLDER_PX && !loadingOlder && !reachedStart) {
      heightBeforeOlder.current = element.scrollHeight;
      onLoadOlder();
    }
  }

  // Follow new messages, but never yank the view away from someone who
  // scrolled up to read back.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const grew = messages.length > previousCount.current;
    previousCount.current = messages.length;

    if (heightBeforeOlder.current !== null && grew) {
      // Older messages went in above: push the view down by exactly what was
      // inserted, so nothing appears to move.
      element.scrollTop += element.scrollHeight - heightBeforeOlder.current;
      heightBeforeOlder.current = null;
      return;
    }

    if (stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    stickToBottom.current = true;
  }, []);

  if (loading) {
    return <div className="flex-1 p-4 text-sm text-ink-500">Berichten laden…</div>;
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-3">
      {messages.length === 0 ? (
        <p className="text-sm text-ink-500">Nog geen berichten. Zeg iets.</p>
      ) : null}

      {messages.length > 0 && loadingOlder ? (
        <p className="py-2 text-center text-xs text-ink-500">Oudere berichten laden…</p>
      ) : null}

      {messages.length > 0 && reachedStart && !loadingOlder ? (
        <p className="py-2 text-center text-xs text-ink-500">
          Dit is het begin van het gesprek.
        </p>
      ) : null}

      {messages.length > 0 && !reachedStart && !loadingOlder ? (
        <div className="py-2 text-center">
          <button
            type="button"
            onClick={onLoadOlder}
            className="min-h-11 rounded px-3 py-2 text-xs text-ink-500 underline hover:text-ink-300"
          >
            Oudere berichten laden
          </button>
        </div>
      ) : null}

      {messages.map((message, index) => {
        const previous = messages[index - 1];
        // Group consecutive messages from the same person: name and time only
        // on the first of a run.
        const grouped = previous?.senderId === message.senderId;

        return (
          <article key={message.id} className={grouped ? 'px-1' : 'mt-3 px-1 first:mt-0'}>
            {grouped ? null : (
              <header className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-ink-100">{message.senderName}</span>
                <time className="text-xs text-ink-500">{formatTime(message.createdAt)}</time>
              </header>
            )}

            {message.unreadable ? (
              <p className="text-sm italic text-ink-500">
                Dit bericht is niet voor jou versleuteld.
              </p>
            ) : (
              <p
                className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${
                  message.status === 'sent' ? 'text-ink-100' : 'text-ink-500'
                }`}
              >
                {message.text ?? <span className="italic text-ink-500">ontsleutelen…</span>}
              </p>
            )}

            {message.signatureValid === false ? (
              <p className="mt-0.5 text-xs text-amber-400">
                ⚠ De handtekening klopt niet. Dit bericht komt mogelijk niet van{' '}
                {message.senderName}.
              </p>
            ) : null}

            {message.status === 'failed' ? (
              <p className="mt-0.5 flex items-center gap-2 text-xs text-red-400">
                Versturen mislukt.
                <button
                  type="button"
                  onClick={() => onRetry(message.id)}
                  className="underline hover:text-red-300"
                >
                  Opnieuw proberen
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss(message.id)}
                  className="text-ink-500 underline hover:text-ink-300"
                >
                  Weggooien
                </button>
              </p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
