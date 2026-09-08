import { useState } from 'react';
import { ErrorNotice } from '../components/ErrorNotice';
import { MemberList } from '../components/MemberList';
import { MessageInput } from '../components/MessageInput';
import { MessageList } from '../components/MessageList';
import { useMessages } from '../hooks/useMessages';
import { channelPrefix } from '../lib/channelName';
import type { ChannelType } from '../types';

interface ConversationViewProps {
  channelId: string;
  title: string;
  channelType: ChannelType;
  currentUserId: string | null;
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
    error,
    loadOlder,
    send,
    retry,
    dismiss,
  } = useMessages(channelId);
  const [showMembers, setShowMembers] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const readerCount = members.length - membersWithoutKey.length;
  const isGroup = channelType === 'group';

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col bg-ink-950">
        <header className="border-b border-ink-800 px-4 py-2.5">
          <div className="flex items-center gap-2">
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

      {showMembers ? <MemberList members={members} currentUserId={currentUserId} /> : null}
    </div>
  );
}
