import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AttachmentView } from './AttachmentView';
import { Avatar } from './Avatar';
import { ContextMenu } from './ContextMenu';
import type { MenuItem } from './ContextMenu';
import { EmojiPicker } from './EmojiPicker';
import { IconButton } from './IconButton';
import { MessageText } from './MessageText';
import { ReactionBar } from './ReactionBar';
import { SkeletonMessages } from './Skeleton';
import type { DisplayMessage } from '../hooks/useMessages';
import type { AttachmentMeta } from '../lib/messagePayload';
import type { ChannelMemberKey, ReactionGroup } from '../types';

interface MessageListProps {
  messages: DisplayMessage[];
  /** Usernames in this channel, so a mention can be told from an at-sign. */
  usernames: readonly string[];
  /** Your own username, so a mention of you stands out. */
  ownUsername: string | null;
  currentUserId: string | null;
  members: readonly ChannelMemberKey[];
  loading: boolean;
  loadingOlder: boolean;
  reachedStart: boolean;
  /** message id -> reaction groups under it. */
  reactions: Record<string, ReactionGroup[]>;
  onLoadOlder: () => void;
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onReply: (message: DisplayMessage) => void;
  onEdit: (messageId: string, plaintext: string) => void;
  onDelete: (messageId: string) => void;
  /**
   * A message to scroll to, set from outside (search results, for now).
   *
   * Declarative rather than an imperative handle: the scroll container lives
   * in here, so the alternative is handing a function back up through a ref,
   * and then the parent has to know when it is safe to call it. As a prop, the
   * effect below runs after the list has rendered whatever it needs to.
   */
  jumpTarget?: string | null;
  /** Reports whether the target was on screen, so the caller can say so. */
  onJumpHandled?: (found: boolean) => void;
  /** Downloads and decrypts an attachment. Comes from useMessages. */
  onLoadAttachment: (meta: AttachmentMeta, senderId: string) => Promise<Blob>;
}

/** How far from the bottom still counts as "following along". */
const STICK_TO_BOTTOM_PX = 80;

/** How close to the top starts fetching the previous page. */
const LOAD_OLDER_PX = 120;

/**
 * Within this window, a second message from the same person joins the first.
 *
 * Five minutes is the spec, and it matches how a conversation reads: three
 * lines typed in one breath are one turn, and the same person picking the
 * thread back up an hour later is not.
 */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

/** Midnight of the day an instant falls on, for comparing calendar days. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * "Vandaag", "Gisteren", or a written-out date.
 *
 * Relative labels only for the two days people actually think of that way. A
 * conversation from last Tuesday labelled "6 dagen geleden" makes the reader
 * do arithmetic to work out which meeting it was.
 */
function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const today = startOfDay(new Date());
  const day = startOfDay(date);
  const dayMs = 24 * 60 * 60 * 1000;

  if (day === today) {
    return 'Vandaag';
  }
  if (day === today - dayMs) {
    return 'Gisteren';
  }

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('nl-NL', {
    weekday: sameYear ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  });
}

export function MessageList({
  messages,
  usernames,
  ownUsername,
  currentUserId,
  members,
  loading,
  loadingOlder,
  reachedStart,
  reactions,
  onLoadOlder,
  onRetry,
  onDismiss,
  onToggleReaction,
  onReply,
  onEdit,
  onDelete,
  jumpTarget = null,
  onJumpHandled,
  onLoadAttachment,
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

  /** The message a jump landed on, so it can flash once. */
  const [flashed, setFlashed] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null);
  /** Which message is being edited, and the draft text. */
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  /** Which message has its emoji picker open. */
  const [picking, setPicking] = useState<string | null>(null);
  /** Which message is one click away from being deleted. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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

  // The flash class has to come off again, or jumping to the same message
  // twice does nothing the second time.
  useEffect(() => {
    if (flashed === null) {
      return;
    }
    const timer = setTimeout(() => setFlashed(null), 1800);
    return () => {
      clearTimeout(timer);
    };
  }, [flashed]);

  /**
   * Scrolls to the message a reply points at.
   *
   * Returns false when it is not on screen, which happens when the original
   * is older than what has been paged in. The caller says so rather than
   * doing nothing, because a button that silently ignores a click reads as
   * broken.
   */
  const jumpTo = useCallback((messageId: string): boolean => {
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!target) {
      return false;
    }

    // Not stickToBottom any more: the user is deliberately looking up.
    stickToBottom.current = false;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashed(messageId);
    return true;
  }, []);

  useEffect(() => {
    if (jumpTarget === null) {
      return;
    }
    onJumpHandled?.(jumpTo(jumpTarget));
  }, [jumpTarget, jumpTo, onJumpHandled]);

  if (loading) {
    return <SkeletonMessages />;
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-2 py-3 md:px-4"
    >
      {messages.length === 0 ? (
        <p className="text-sm text-muted">Nog geen berichten. Zeg iets.</p>
      ) : null}

      {messages.length > 0 && loadingOlder ? (
        <p role="status" className="py-2 text-center text-xs text-muted">
          Oudere berichten laden…
        </p>
      ) : null}

      {messages.length > 0 && reachedStart && !loadingOlder ? (
        <p className="py-2 text-center text-xs text-muted">
          Dit is het begin van het gesprek.
        </p>
      ) : null}

      {messages.length > 0 && !reachedStart && !loadingOlder ? (
        <div className="py-2 text-center">
          <button
            type="button"
            onClick={onLoadOlder}
            className="min-h-11 rounded-md px-3 py-2 text-xs text-muted underline transition-colors hover:text-secondary"
          >
            Oudere berichten laden
          </button>
        </div>
      ) : null}

      {messages.map((message, index) => {
        const previous = messages[index - 1];

        // A new calendar day always breaks a group, so the separator never
        // lands in the middle of one.
        const newDay =
          previous === undefined ||
          startOfDay(new Date(previous.createdAt)) !== startOfDay(new Date(message.createdAt));

        const withinWindow =
          previous !== undefined &&
          new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
            GROUP_WINDOW_MS;

        // A reply always starts its own group: it carries a preview above it,
        // and hanging that under someone else's header reads as part of it.
        const grouped =
          !newDay &&
          withinWindow &&
          previous?.senderId === message.senderId &&
          message.replyTo === null &&
          !message.deleted;

        return (
          <div key={message.id}>
            {newDay ? <DaySeparator iso={message.createdAt} /> : null}
            <MessageRow
              message={message}
              grouped={grouped}
              usernames={usernames}
              ownUsername={ownUsername}
              isOwn={message.senderId === currentUserId}
              member={members.find((candidate) => candidate.userId === message.senderId) ?? null}
              reactions={reactions[message.id] ?? []}
              flashed={flashed === message.id}
              editing={editing?.id === message.id ? editing.draft : null}
              picking={picking === message.id}
              confirmingDelete={confirmDelete === message.id}
              onStartEdit={() => {
                setEditing({ id: message.id, draft: message.text ?? '' });
                setConfirmDelete(null);
              }}
              onChangeEdit={(draft) => setEditing({ id: message.id, draft })}
              onCancelEdit={() => setEditing(null)}
              onSubmitEdit={() => {
                if (editing && editing.draft.trim() !== '') {
                  onEdit(message.id, editing.draft);
                }
                setEditing(null);
              }}
              onSetPicking={(open) => setPicking(open ? message.id : null)}
              onToggleReaction={(emoji) => {
                onToggleReaction(message.id, emoji);
                setPicking(null);
              }}
              onReply={() => onReply(message)}
              onAskDelete={() => setConfirmDelete(message.id)}
              onCancelDelete={() => setConfirmDelete(null)}
              onConfirmDelete={() => {
                onDelete(message.id);
                setConfirmDelete(null);
              }}
              onRetry={() => onRetry(message.id)}
              onDismiss={() => onDismiss(message.id)}
              onJump={jumpTo}
              onOpenMenu={(items, x, y) => setMenu({ items, x, y })}
              onLoadAttachment={onLoadAttachment}
            />
          </div>
        );
      })}

      {menu ? (
        <ContextMenu
          label="Berichtacties"
          items={menu.items}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-subtle" />
      <span className="text-2xs font-semibold uppercase tracking-wider text-muted">
        {formatDayLabel(iso)}
      </span>
      <span className="h-px flex-1 bg-subtle" />
    </div>
  );
}

interface MessageRowProps {
  message: DisplayMessage;
  grouped: boolean;
  usernames: readonly string[];
  ownUsername: string | null;
  isOwn: boolean;
  member: ChannelMemberKey | null;
  reactions: ReactionGroup[];
  flashed: boolean;
  /** The draft text while editing, or null when not editing. */
  editing: string | null;
  picking: boolean;
  confirmingDelete: boolean;
  onStartEdit: () => void;
  onChangeEdit: (draft: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  onSetPicking: (open: boolean) => void;
  onToggleReaction: (emoji: string) => void;
  onReply: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onJump: (messageId: string) => boolean;
  onOpenMenu: (items: MenuItem[], x: number, y: number) => void;
  onLoadAttachment: (meta: AttachmentMeta, senderId: string) => Promise<Blob>;
}

function MessageRow({
  message,
  grouped,
  usernames,
  ownUsername,
  isOwn,
  member,
  reactions,
  flashed,
  editing,
  picking,
  confirmingDelete,
  onStartEdit,
  onChangeEdit,
  onCancelEdit,
  onSubmitEdit,
  onSetPicking,
  onToggleReaction,
  onReply,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onRetry,
  onDismiss,
  onJump,
  onOpenMenu,
  onLoadAttachment,
}: MessageRowProps) {
  const [jumpFailed, setJumpFailed] = useState(false);
  const displayName = member?.displayName ?? message.senderName;

  // Optimistic rows have no server id yet, so nothing that needs one is
  // offered on them: you cannot react to, reply to or delete a message that
  // does not exist on the server.
  const isLocal = message.status !== 'sent';
  const canAct = !isLocal && !message.deleted;

  function buildMenu(): MenuItem[] {
    const items: MenuItem[] = [];

    if (message.text !== null && !message.deleted) {
      items.push({
        label: 'Tekst kopiëren',
        icon: '⧉',
        onSelect: () => {
          void navigator.clipboard.writeText(message.text ?? '').catch(() => {
            // Denied clipboard permission. The text is selectable anyway.
          });
        },
      });
    }
    if (canAct) {
      items.push({ label: 'Antwoorden', icon: '↩', onSelect: onReply });
      items.push({ label: 'Reageren', icon: '☺', onSelect: () => onSetPicking(true) });
    }
    if (canAct && isOwn) {
      items.push({ label: 'Bewerken', icon: '✎', onSelect: onStartEdit });
      items.push({
        label: 'Verwijderen',
        icon: '🗑',
        danger: true,
        onSelect: onAskDelete,
      });
    }

    return items;
  }

  function handleContextMenu(event: React.MouseEvent): void {
    const items = buildMenu();
    if (items.length === 0) {
      return;
    }
    // Only take over the browser menu when we have something to offer
    // instead. On a message that is still sending, the native menu (with
    // "copy" for a selection) is more useful than an empty one of ours.
    event.preventDefault();
    onOpenMenu(items, event.clientX, event.clientY);
  }

  return (
    <article
      data-message-id={message.id}
      onContextMenu={handleContextMenu}
      className={`group/msg relative flex gap-2 rounded-md px-1 transition-colors hover:bg-hover/40 ${
        grouped ? '' : 'mt-[var(--vault-msg-gap)] first:mt-0'
      } ${flashed ? 'vault-flash' : ''}`}
      style={{ paddingTop: 'var(--vault-msg-row-pad)', paddingBottom: 'var(--vault-msg-row-pad)' }}
    >
      {/* The avatar column stays reserved on a grouped row, so the text of a
          run of messages lines up under itself. */}
      <div className="w-9 shrink-0 pt-0.5">
        {grouped ? null : (
          <Avatar
            userId={message.senderId}
            name={displayName}
            url={member?.avatarUrl ?? null}
            size="md"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {message.replyTo ? (
          <ReplyLine
            preview={message.replyTo}
            failed={jumpFailed}
            onJump={() => {
              const ok = onJump(message.replyTo?.id ?? '');
              setJumpFailed(!ok);
            }}
          />
        ) : null}

        {grouped ? null : (
          <header className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-primary">{displayName}</span>
            {member && member.displayName ? (
              <span className="text-2xs text-muted">@{member.username}</span>
            ) : null}
            <time dateTime={message.createdAt} className="text-2xs text-muted">
              {formatTime(message.createdAt)}
            </time>
          </header>
        )}

        {message.deleted ? (
          <p className="text-sm italic text-muted">Dit bericht is verwijderd.</p>
        ) : message.unreadable ? (
          <p className="text-sm italic text-muted">Dit bericht is niet voor jou versleuteld.</p>
        ) : editing !== null ? (
          <EditBox
            draft={editing}
            onChange={onChangeEdit}
            onCancel={onCancelEdit}
            onSubmit={onSubmitEdit}
          />
        ) : (
          <div className={message.status === 'sent' ? '' : 'opacity-60'}>
            {message.text === null ? (
              <p className="text-sm italic text-muted">ontsleutelen…</p>
            ) : (
              <>
                <MessageText
                  text={message.text}
                  usernames={usernames}
                  ownUsername={ownUsername}
                />
                {message.editedAt ? (
                  <span
                    title={`Bewerkt op ${new Date(message.editedAt).toLocaleString('nl-NL')}`}
                    className="ml-1 align-baseline text-2xs text-muted"
                  >
                    (bewerkt)
                  </span>
                ) : null}
              </>
            )}
          </div>
        )}

        {/* Attachments survive an edit, so they render outside the edit box
            and under a deleted message they are gone with the metadata. */}
        {!message.deleted ? (
          <AttachmentView
            attachments={message.attachments}
            senderId={message.senderId}
            onLoad={onLoadAttachment}
          />
        ) : null}

        {message.signatureValid === false ? (
          <p className="mt-0.5 text-xs text-warning">
            ⚠ De handtekening klopt niet. Dit bericht komt mogelijk niet van {displayName}.
          </p>
        ) : null}

        <ReactionBar groups={reactions} onToggle={onToggleReaction} />

        {confirmingDelete ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-danger">
            Dit bericht verwijderen? De inhoud wordt van de server gewist.
            <button
              type="button"
              onClick={onConfirmDelete}
              className="rounded px-1.5 py-0.5 font-medium underline transition-colors hover:bg-danger-soft"
            >
              Verwijderen
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="rounded px-1.5 py-0.5 text-muted underline transition-colors hover:text-secondary"
            >
              Annuleren
            </button>
          </p>
        ) : null}

        {message.status === 'failed' ? (
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-danger">
            Versturen mislukt.
            <button
              type="button"
              onClick={onRetry}
              className="underline transition-colors hover:text-danger-hover"
            >
              Opnieuw proberen
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="text-muted underline transition-colors hover:text-secondary"
            >
              Weggooien
            </button>
          </p>
        ) : null}
      </div>

      {/*
       * The hover toolbar.
       *
       * opacity rather than conditional rendering, and focus-within alongside
       * hover: a keyboard user tabbing into these buttons has no hover, and
       * buttons that only exist on hover are buttons a keyboard cannot reach.
       */}
      {canAct ? (
        <div className="relative shrink-0 self-start opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
          <div className="flex items-center gap-0.5 rounded-md border border-subtle bg-overlay px-0.5 shadow-sm">
            <IconButton
              label="Reageren"
              size="sm"
              onClick={() => onSetPicking(!picking)}
              active={picking}
            >
              ☺
            </IconButton>
            <IconButton label="Antwoorden" size="sm" onClick={onReply}>
              ↩
            </IconButton>
            {isOwn ? (
              <>
                <IconButton label="Bewerken" size="sm" onClick={onStartEdit}>
                  ✎
                </IconButton>
                <IconButton label="Verwijderen" size="sm" onClick={onAskDelete}>
                  🗑
                </IconButton>
              </>
            ) : null}
          </div>

          {picking ? (
            <EmojiPicker
              align="right"
              onPick={onToggleReaction}
              onClose={() => onSetPicking(false)}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ReplyLine({
  preview,
  failed,
  onJump,
}: {
  preview: NonNullable<DisplayMessage['replyTo']>;
  failed: boolean;
  onJump: () => void;
}) {
  const body = preview.deleted
    ? 'bericht verwijderd'
    : preview.missing
      ? 'origineel niet meer beschikbaar'
      : (preview.text ?? 'ontsleutelen…');

  return (
    <div className="flex items-center gap-1.5 text-2xs text-muted">
      <span aria-hidden="true" className="text-strong">
        ↳
      </span>
      <button
        type="button"
        onClick={onJump}
        className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-hover hover:text-secondary"
      >
        <span className="font-medium text-secondary">{preview.senderName}</span>
        {/* One line only: a preview that wraps to four lines is not a preview. */}
        <span className="truncate italic">{body.replace(/\s*\n\s*/g, ' ')}</span>
      </button>
      {failed ? (
        <span className="shrink-0">— laad eerst oudere berichten</span>
      ) : null}
    </div>
  );
}

function EditBox({
  draft,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    element.focus();
    // Cursor at the end, not selecting everything: an edit is usually a fix
    // at the end of a sentence, and a full selection means one keystroke
    // wipes the message.
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  return (
    <div className="mt-1">
      <textarea
        ref={ref}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        rows={2}
        aria-label="Bericht bewerken"
        className="w-full resize-none rounded-md border border-subtle bg-inset px-2.5 py-2 text-base text-primary outline-none focus:border-accent sm:text-sm"
      />
      <div className="mt-1 flex items-center gap-2 text-2xs text-muted">
        <button
          type="button"
          onClick={onSubmit}
          className="rounded px-1.5 py-0.5 font-medium text-accent underline transition-colors hover:bg-accent-soft"
        >
          Opslaan
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-1.5 py-0.5 underline transition-colors hover:text-secondary"
        >
          Annuleren
        </button>
        <span>
          Wordt opnieuw versleuteld voor de huidige leden. Enter slaat op, Esc annuleert.
        </span>
      </div>
    </div>
  );
}
