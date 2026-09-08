import { useState } from 'react';
import { ErrorNotice } from '../components/ErrorNotice';
import { MemberList } from '../components/MemberList';
import { MessageInput } from '../components/MessageInput';
import { MessageList } from '../components/MessageList';
import { useMessages } from '../hooks/useMessages';

interface ConversationViewProps {
  channelId: string;
  title: string;
  /** '#' for a server channel, '@' for a DM. */
  prefix: string;
  currentUserId: string | null;
}

/**
 * One conversation, whatever kind of channel it is.
 *
 * A DM and a server channel are the same thing here: same table, same
 * encryption, same realtime. Nothing below this point knows the difference.
 */
export function ConversationView({
  channelId,
  title,
  prefix,
  currentUserId,
}: ConversationViewProps) {
  const { messages, members, membersWithoutKey, loading, error, send, retry, dismiss } =
    useMessages(channelId);
  const [showMembers, setShowMembers] = useState(true);

  const readerCount = members.length - membersWithoutKey.length;

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col bg-ink-950">
        <header className="flex items-center gap-2 border-b border-ink-800 px-4 py-2.5">
          <span className="text-ink-500">{prefix}</span>
          <h1 className="truncate text-sm font-semibold text-ink-100">{title}</h1>

          <span className="ml-auto text-xs text-ink-500">
            versleuteld voor {readerCount} {readerCount === 1 ? 'lid' : 'leden'}
          </span>
          <button
            type="button"
            onClick={() => setShowMembers((open) => !open)}
            className="rounded px-2 py-1 text-xs text-ink-500 hover:bg-ink-800 hover:text-ink-100"
          >
            {showMembers ? 'Leden verbergen' : 'Leden tonen'}
          </button>
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
          onRetry={(localId) => {
            void retry(localId);
          }}
          onDismiss={dismiss}
        />

        <MessageInput
          onSend={(plaintext) => {
            void send(plaintext);
          }}
          placeholder={`Bericht aan ${prefix}${title}`}
        />
      </section>

      {showMembers ? <MemberList members={members} currentUserId={currentUserId} /> : null}
    </div>
  );
}
