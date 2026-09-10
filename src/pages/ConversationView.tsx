import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorNotice, WarningNotice } from '../components/ErrorNotice';
import { IconButton } from '../components/IconButton';
import { MemberList } from '../components/MemberList';
import { MessageInput } from '../components/MessageInput';
import type { ReplyTarget } from '../components/MessageInput';
import { MessageList } from '../components/MessageList';
import { MessageSearch } from '../components/MessageSearch';
import { useIsWideScreen } from '../hooks/useMediaQuery';
import { useMessages } from '../hooks/useMessages';
import { useReactions } from '../hooks/useReactions';
import { describeTyping, useTyping } from '../hooks/useTyping';
import { channelPrefix } from '../lib/channelName';
import type { ChannelType } from '../types';

interface ConversationViewProps {
  channelId: string;
  title: string;
  channelType: ChannelType;
  /** Shown under the title, when the channel has one. */
  description?: string | null;
  currentUserId: string | null;
  /** Mobile only: back to the list this conversation came from. */
  onBack: () => void;
  /** Groups only: adding someone, and getting out. */
  onAddMember?: () => void;
  onLeaveGroup?: () => void;
  /** Opens somebody's profile card. */
  onOpenProfile?: (userId: string) => void;
}

/**
 * One conversation, whatever kind of channel it is.
 *
 * A DM, a group and a server channel are the same thing here: same table, same
 * encryption, same realtime. Nothing below this point knows the difference —
 * the type only decides which glyph goes in front and whether the group
 * controls are shown.
 */
export function ConversationView({
  channelId,
  title,
  channelType,
  description = null,
  currentUserId,
  onBack,
  onAddMember,
  onLeaveGroup,
  onOpenProfile,
}: ConversationViewProps) {
  const {
    messages,
    members,
    membersWithoutKey,
    loading,
    loadingOlder,
    reachedStart,
    connected,
    error,
    loadOlder,
    send,
    retry,
    dismiss,
    edit,
    remove,
    attachmentProgress,
    loadAttachment,
  } = useMessages(channelId);

  const wide = useIsWideScreen();
  // On a phone the member list is a drawer over the conversation, so it starts
  // closed; on a wide screen it is a column that costs nothing.
  const [showMembers, setShowMembers] = useState(wide);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [searching, setSearching] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);

  const readerCount = members.length - membersWithoutKey.length;
  const isGroup = channelType === 'group';

  // Derived here rather than in MessageList: every message needs the same
  // list, and recomputing it per row would walk the member list once per
  // message on every render.
  const usernames = useMemo(() => members.map((member) => member.username), [members]);
  const ownUsername =
    members.find((member) => member.userId === currentUserId)?.username ?? null;

  // Only the server ids: an optimistic row has no reactions and no row to
  // fetch them from.
  const messageIds = useMemo(
    () => messages.filter((message) => message.status === 'sent').map((message) => message.id),
    [messages],
  );

  const { groups: reactions, toggle: toggleReaction, error: reactionError } = useReactions(
    channelId,
    messageIds,
    members,
  );

  const { typing, announce, stop: stopTyping } = useTyping(channelId, ownUsername);

  // Switching channels must not carry a reply banner or an open search panel
  // across; both point at messages that are no longer on screen.
  useEffect(() => {
    setReplyTo(null);
    setSearching(false);
    setJumpTarget(null);
  }, [channelId]);

  const handleSend = useCallback(
    (plaintext: string, files: File[]): void => {
      void send(plaintext, replyTo?.id ?? null, files);
      setReplyTo(null);
      stopTyping();
    },
    [send, replyTo, stopTyping],
  );

  const typingLine = describeTyping(typing);

  return (
    <div className="relative flex min-w-0 flex-1">
      <section className="relative flex min-w-0 flex-1 flex-col bg-base">
        <header className="border-b border-subtle px-2 py-2 md:px-4 md:py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              aria-label="Terug naar de lijst"
              className="-ml-1 flex h-11 w-9 shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-overlay md:hidden"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <span aria-hidden="true" className="text-muted">
              {channelPrefix(channelType)}
            </span>
            <h1 className="truncate text-md font-semibold text-primary">{title}</h1>

            {description ? (
              <>
                <span aria-hidden="true" className="hidden text-strong lg:inline">
                  |
                </span>
                <p className="hidden min-w-0 flex-1 truncate text-xs text-muted lg:block">
                  {description}
                </p>
              </>
            ) : null}

            <span
              className={`ml-auto hidden text-2xs text-muted sm:inline ${
                description ? 'lg:hidden xl:inline' : ''
              }`}
            >
              versleuteld voor {readerCount} {readerCount === 1 ? 'lid' : 'leden'}
            </span>

            <div className="ml-auto flex items-center gap-0.5 sm:ml-0">
              <IconButton
                label="Zoeken in dit gesprek"
                size="sm"
                onClick={() => setSearching((open) => !open)}
                active={searching}
              >
                🔍
              </IconButton>
              <IconButton
                label={showMembers ? 'Leden verbergen' : 'Leden tonen'}
                size="sm"
                onClick={() => setShowMembers((open) => !open)}
                active={showMembers}
              >
                👥
              </IconButton>
            </div>
          </div>

          {isGroup ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 flex-1 truncate text-xs text-muted">
                {members.length === 0
                  ? 'Leden laden…'
                  : members.map((member) => member.displayName ?? member.username).join(', ')}
              </p>

              {onAddMember ? (
                <button
                  type="button"
                  onClick={onAddMember}
                  className="min-h-11 rounded-md px-2 py-1 text-xs text-secondary transition-colors hover:bg-overlay hover:text-primary"
                >
                  Lid toevoegen
                </button>
              ) : null}

              {onLeaveGroup ? (
                confirmLeave ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={onLeaveGroup}
                      className="min-h-11 rounded-md px-2 py-1 text-xs text-danger transition-colors hover:bg-danger-soft"
                    >
                      Zeker weten?
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmLeave(false)}
                      className="min-h-11 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-overlay"
                    >
                      Nee
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmLeave(true)}
                    className="min-h-11 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-overlay hover:text-primary"
                  >
                    Groep verlaten
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </header>

        {searching ? (
          <MessageSearch
            messages={messages}
            loadingOlder={loadingOlder}
            reachedStart={reachedStart}
            onLoadOlder={() => {
              void loadOlder();
            }}
            onJump={(messageId) => setJumpTarget(messageId)}
            onClose={() => setSearching(false)}
          />
        ) : null}

        {!connected ? (
          <p
            role="status"
            className="bg-warning-soft px-4 py-1.5 text-center text-xs text-warning"
          >
            Verbinding verbroken. Nieuwe berichten komen pas binnen als de
            verbinding terug is.
          </p>
        ) : null}

        <div className="px-4 pt-2 empty:hidden">
          <ErrorNotice message={error ?? reactionError} />
        </div>

        {membersWithoutKey.length > 0 ? (
          <div className="mx-4 mt-2">
            <WarningNotice>
              {membersWithoutKey.map((member) => member.username).join(', ')}{' '}
              {membersWithoutKey.length === 1 ? 'heeft' : 'hebben'} nog geen sleutel en
              kan je berichten niet lezen. Je verstuurt wel, maar niet aan{' '}
              {membersWithoutKey.length === 1 ? 'hem of haar' : 'hen'}.
            </WarningNotice>
          </div>
        ) : null}

        <MessageList
          messages={messages}
          usernames={usernames}
          ownUsername={ownUsername}
          currentUserId={currentUserId}
          members={members}
          loading={loading}
          loadingOlder={loadingOlder}
          reachedStart={reachedStart}
          reactions={reactions}
          onLoadOlder={() => {
            void loadOlder();
          }}
          onRetry={(localId) => {
            void retry(localId);
          }}
          onDismiss={dismiss}
          onToggleReaction={(messageId, emoji) => {
            void toggleReaction(messageId, emoji);
          }}
          onReply={(message) =>
            setReplyTo({
              id: message.id,
              senderName: message.senderName,
              text: message.text,
            })
          }
          onEdit={(messageId, plaintext) => {
            void edit(messageId, plaintext);
          }}
          onDelete={(messageId) => {
            void remove(messageId);
          }}
          jumpTarget={jumpTarget}
          onJumpHandled={() => setJumpTarget(null)}
          onLoadAttachment={loadAttachment}
          onOpenProfile={onOpenProfile}
        />

        {/*
         * The typing line sits above the box and takes up room whether or not
         * anybody is typing. Reserving the height stops the whole conversation
         * from bouncing a line up and down every few seconds.
         */}
        <p
          aria-live="polite"
          className="h-4 truncate px-3 text-2xs text-muted md:px-4"
        >
          {typingLine}
        </p>

        <MessageInput
          onSend={handleSend}
          usernames={usernames}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onTyping={announce}
          uploading={attachmentProgress}
          placeholder={`Bericht aan ${channelPrefix(channelType)}${title}`}
        />
      </section>

      {showMembers ? (
        <>
          {/* On a phone the list slides over the conversation instead of
              squeezing it into a third of the screen. */}
          <button
            type="button"
            aria-label="Ledenlijst sluiten"
            onClick={() => setShowMembers(false)}
            className="absolute inset-0 z-20 bg-scrim md:hidden"
          />
          <div className="absolute inset-y-0 right-0 z-30 flex w-72 max-w-[85%] md:static md:z-auto md:w-auto md:max-w-none">
            <MemberList
              members={members}
              currentUserId={currentUserId}
              onOpenProfile={onOpenProfile}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
