import { useState } from 'react';
import { Button } from '../components/Button';
import { ChannelList } from '../components/ChannelList';
import { ErrorNotice } from '../components/ErrorNotice';
import { Fingerprint } from '../components/Fingerprint';
import { MessageInput } from '../components/MessageInput';
import { MessageList } from '../components/MessageList';
import { NewDmDialog } from '../components/NewDmDialog';
import { useAuth } from '../hooks/useAuth';
import { useChannels } from '../hooks/useChannels';
import { useMessages } from '../hooks/useMessages';
import { describeError } from '../lib/errorMessages';

export function AppShell() {
  const { profile, signOut, exportEncryptedKey } = useAuth();
  const { channels, loading: channelsLoading, error: channelsError, startDm } = useChannels();

  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [showNewDm, setShowNewDm] = useState(false);
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { messages, loading, error, send, retry, dismiss } = useMessages(activeChannelId);
  const activeChannel = channels.find((channel) => channel.id === activeChannelId) ?? null;

  async function handleExport(): Promise<void> {
    setExportError(null);
    try {
      const armored = await exportEncryptedKey();
      const blob = new Blob([armored], { type: 'application/pgp-keys' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vault-key-${profile?.username ?? 'account'}.asc`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setExportError(describeError(caught));
    }
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        <ChannelList
          channels={channels}
          activeId={activeChannelId}
          loading={channelsLoading}
          onSelect={setActiveChannelId}
          onNewDm={() => setShowNewDm(true)}
        />

        <div className="border-t border-ink-800 p-2">
          <button
            type="button"
            onClick={() => setShowKeyPanel((open) => !open)}
            className="w-full truncate rounded px-2 py-1.5 text-left text-sm text-ink-300 hover:bg-ink-850"
          >
            {profile?.username} <span className="text-ink-500">· sleutel</span>
          </button>

          {showKeyPanel ? (
            <div className="mt-2 rounded border border-ink-800 bg-ink-850 p-2">
              {profile ? <Fingerprint value={profile.fingerprint} /> : null}
              <p className="mt-2 text-xs leading-relaxed text-ink-500">
                Vergelijk deze vingerafdruk buiten Vault om met je gesprekspartner.
              </p>
              <div className="mt-2 flex flex-col gap-1">
                <Button
                  variant="ghost"
                  onClick={() => {
                    void handleExport();
                  }}
                >
                  Sleutel exporteren
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    void signOut();
                  }}
                >
                  Uitloggen
                </Button>
              </div>
              <div className="mt-2">
                <ErrorNotice message={exportError} />
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-ink-950">
        {activeChannelId ? (
          <>
            <header className="flex items-center gap-2 border-b border-ink-800 px-4 py-2.5">
              <span className="text-ink-500">@</span>
              <h1 className="truncate text-sm font-semibold text-ink-100">
                {activeChannel?.displayName ?? 'gesprek'}
              </h1>
              <span className="ml-auto text-xs text-ink-500">end-to-end versleuteld</span>
            </header>

            <div className="px-4 pt-2">
              <ErrorNotice message={error ?? channelsError} />
            </div>

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
              placeholder={`Bericht aan ${activeChannel?.displayName ?? ''}`}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-ink-500">
            <div>
              <p>Kies links een gesprek, of begin er een nieuwe.</p>
              <p className="mt-2 text-xs">
                Berichten worden in je browser versleuteld. De server ziet alleen ciphertext.
              </p>
            </div>
          </div>
        )}
      </section>

      {showNewDm ? (
        <NewDmDialog
          onClose={() => setShowNewDm(false)}
          onStart={startDm}
          onStarted={setActiveChannelId}
        />
      ) : null}
    </div>
  );
}
