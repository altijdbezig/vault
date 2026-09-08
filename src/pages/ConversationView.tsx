import { useState } from 'react';
import { ErrorNotice } from '../components/ErrorNotice';
import { MemberList } from '../components/MemberList';
import { MessageInput } from '../components/MessageInput';
import { MessageList } from '../components/MessageList';
import { useIsWideScreen } from '../hooks/useMediaQuery';
import { useMessages } from '../hooks/useMessages';
import { channelPrefix } from '../lib/channelName';
import type { ChannelType } from '../types';

interface ConversationViewProps {
  channelId: string;
  title: string;
  channelType: ChannelType;
  currentUserId: string | null;
  /** Mobile only: back to the list this conversation came from. */
  onBack: () => void;
  /** Groups only: adding someone, and getting out. */
  onAddMember?: () => void;
  onLeaveGroup?: () => void;
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
  currentUserId,
  onBack,
  onAddMember,
  onLeaveGroup,
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
  } = useMessages(channelId);
  const wide = useIsWideScreen();
  // On a phone the member list is a drawer over the conversation, so it starts
  // closed; on a wide screen it is a column that costs nothing.
  const [showMembers, setShowMembers] = useState(wide);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const readerCount = members.length - membersWithoutKey.length;
  const isGroup = channelType === 'group';

  return (
    <div className="relative flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col bg-ink-950">
        <header className="border-b border-ink-800 px-2 py-2 md:px-4 md:py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              aria-label="Terug naar de lijst"
              className="-ml-1 flex h-11 w-9 shrink-0 items-center justify-center rounded text-ink-300 hover:bg-ink-800 md:hidden"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <span aria-hidden="true" className="text-ink-500">
              {channelPrefix(channelType)}
            </span>
            <h1 className="truncate text-sm font-semibold text-ink-100">{title}</h1>

            <span className="ml-auto hidden text-xs text-ink-500 sm:inline">
              versleuteld voor {readerCount} {readerCount === 1 ? 'lid' : 'leden'}
            </span>
            <button
              type="button"
              onClick={() => setShowMembers((open) => !open)}
              className="ml-auto min-h-11 rounded px-2 py-1 text-xs text-ink-500 hover:bg-ink-800 hover:text-ink-100 sm:ml-0"
            >
              {showMembers ? 'Leden verbergen' : 'Leden tonen'}
            </button>
          </div>

          {isGroup ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 flex-1 truncate text-xs text-ink-500">
                {members.length === 0
                  ? 'Leden laden…'
                  : members.map((member) => member.username).join(', ')}
              </p>

              {onAddMember ? (
                <button
                  type="button"
                  onClick={onAddMember}
                  className="min-h-11 rounded px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 hover:text-ink-100"
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
                      className="min-h-11 rounded px-2 py-1 text-xs text-red-400 hover:bg-ink-800"
                    >
                      Zeker weten?
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmLeave(false)}
                      className="min-h-11 rounded px-2 py-1 text-xs text-ink-500 hover:bg-ink-800"
                    >
                      Nee
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmLeave(true)}
                    className="min-h-11 rounded px-2 py-1 text-xs text-ink-500 hover:bg-ink-800 hover:text-ink-100"
                  >
                    Groep verlaten
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </header>

        {!connected ? (
          <p
            role="status"
            className="bg-amber-950/60 px-4 py-1.5 text-center text-xs text-amber-200"
          >
            Verbinding verbroken. Nieuwe berichten komen pas binnen als de
            verbinding terug is.
          </p>
        ) : null}

        <div className="px-4 pt-2 empty:hidden">
          <ErrorNotice message={error} />
        </div>

        {membersWithoutKey.length > 0 ? (
          <p className="mx-4 mt-2 rounded border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs leading-relaxed text-amber-200">
            {membersWithoutKey.map((member) => member.username).join(', ')}{' '}
            {membersWithoutKey.length === 1 ? 'heeft' : 'hebben'} nog geen sleutel en
            kan je berichten niet lezen. Je verstuurt wel, maar niet aan{' '}
            {membersWithoutKey.length === 1 ? 'hem of haar' : 'hen'}.
          </p>
        ) : null}

        <MessageList
          messages={messages}
          loading={loading}
          loadingOlder={loadingOlder}
          reachedStart={reachedStart}
          onLoadOlder={() => {
            void loadOlder();
          }}
          onRetry={(localId) => {
            void retry(localId);
          }}
          onDismiss={dismiss}
        />

        <MessageInput
          onSend={(plaintext) => {
            void send(plaintext);
          }}
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
            className="absolute inset-0 z-20 bg-black/60 md:hidden"
          />
          <div className="absolute inset-y-0 right-0 z-30 flex w-72 max-w-[85%] md:static md:z-auto md:w-auto md:max-w-none">
            <MemberList members={members} currentUserId={currentUserId} />
          </div>
        </>
      ) : null}
    </div>
  );
}
