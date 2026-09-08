import { useEffect, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { ChannelList } from '../components/ChannelList';
import { ChannelSidebar } from '../components/ChannelSidebar';
import { CreateChannelDialog } from '../components/CreateChannelDialog';
import { CreateServerDialog } from '../components/CreateServerDialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { Fingerprint } from '../components/Fingerprint';
import { NewDmDialog } from '../components/NewDmDialog';
import { ServerRail } from '../components/ServerRail';
import { useAuth } from '../hooks/useAuth';
import { useChannels } from '../hooks/useChannels';
import { useServerChannels, useServers } from '../hooks/useServers';
import { describeError } from '../lib/errorMessages';
import { ConversationView } from './ConversationView';

/** Remembers where you were, so "/" can send you back there. */
const LAST_PATH_KEY = 'vault:last-path';
/** Remembered separately, so the DM button reopens your last conversation. */
const LAST_DM_PATH_KEY = 'vault:last-dm-path';

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, path: string): void {
  try {
    localStorage.setItem(key, path);
  } catch {
    // A blocked storage API is not worth breaking navigation over.
  }
}

export function AppShell() {
  const { user, profile, signOut, exportEncryptedKey } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Routes: /dm, /dm/:channelId, /server/:serverId, /server/:serverId/:channelId
  //
  // /dm exists as a route of its own so the DM button has somewhere to go.
  // Sending it to "/" instead put it straight back into the redirect below,
  // which bounced it into the server it had just left.
  const dmMatch = useMatch('/dm/:channelId');
  const serverMatch = useMatch('/server/:serverId');
  const serverChannelMatch = useMatch('/server/:serverId/:channelId');

  const activeServerId =
    serverChannelMatch?.params.serverId ?? serverMatch?.params.serverId ?? null;
  const activeChannelId =
    serverChannelMatch?.params.channelId ?? dmMatch?.params.channelId ?? null;
  const dmMode = activeServerId === null;

  const { channels: dmChannels, loading: dmLoading, error: dmError, startDm } = useChannels();
  const { servers, createServer, joinServer } = useServers();

  const activeServer = servers.find((server) => server.id === activeServerId) ?? null;
  const {
    channels: serverChannels,
    members: serverMembers,
    loading: serverChannelsLoading,
    error: serverError,
    canCreateChannel,
    createChannel,
  } = useServerChannels(activeServerId, activeServer?.role ?? null);

  const [showNewDm, setShowNewDm] = useState(false);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Remember the last real destination for the "/" redirect.
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith('/dm/') || path.startsWith('/server/')) {
      writeStored(LAST_PATH_KEY, path);
    }
    if (path.startsWith('/dm/')) {
      writeStored(LAST_DM_PATH_KEY, path);
    }
  }, [location.pathname]);

  // "/" goes back to where you were, or stays on the empty state.
  useEffect(() => {
    if (location.pathname !== '/') {
      return;
    }
    const last = readStored(LAST_PATH_KEY);
    if (last && last !== '/') {
      navigate(last, { replace: true });
    }
  }, [location.pathname, navigate]);

  // /server/:serverId with no channel: open the first channel of that server.
  //
  // Depends on the id, not the array: listServerChannels returns a fresh array
  // every call, and an array in the dependency list would re-run this on every
  // reload. useServerChannels only reports channels once they belong to the
  // server in the URL, so this can no longer fire with the previous server's
  // list and strand the user on a channel from somewhere else.
  const firstChannelId = serverChannels[0]?.id ?? null;
  useEffect(() => {
    if (!serverMatch || serverChannelsLoading || !firstChannelId) {
      return;
    }
    navigate(`/server/${serverMatch.params.serverId}/${firstChannelId}`, { replace: true });
  }, [navigate, firstChannelId, serverChannelsLoading, serverMatch]);

  /** The DM button: back to your last conversation, or the list. */
  function goToDmMode(): void {
    const last = readStored(LAST_DM_PATH_KEY);
    const stillExists =
      last !== null && dmChannels.some((channel) => last === `/dm/${channel.id}`);
    navigate(stillExists && last ? last : '/dm');
  }

  const activeChannelTitle = activeServerId
    ? (serverChannels.find((channel) => channel.id === activeChannelId)?.displayName ?? 'kanaal')
    : (dmChannels.find((channel) => channel.id === activeChannelId)?.displayName ?? 'gesprek');

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
      <ServerRail
        servers={servers}
        activeServerId={activeServerId}
        dmActive={dmMode}
        onSelectDm={goToDmMode}
        onSelectServer={(serverId) => navigate(`/server/${serverId}`)}
        onCreateServer={() => setShowCreateServer(true)}
      />

      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        {activeServer ? (
          <ChannelSidebar
            server={activeServer}
            channels={serverChannels}
            activeChannelId={activeChannelId}
            loading={serverChannelsLoading}
            canCreateChannel={canCreateChannel}
            memberCount={serverMembers.length}
            onSelect={(channelId) => navigate(`/server/${activeServer.id}/${channelId}`)}
            onCreateChannel={() => setShowCreateChannel(true)}
          />
        ) : (
          <ChannelList
            channels={dmChannels}
            activeId={activeChannelId}
            loading={dmLoading}
            onSelect={(channelId) => navigate(`/dm/${channelId}`)}
            onNewDm={() => setShowNewDm(true)}
          />
        )}

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
                Vergelijk deze vingerafdruk buiten Vault om met je gesprekspartners.
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

      {activeChannelId ? (
        <ConversationView
          key={activeChannelId}
          channelId={activeChannelId}
          title={activeChannelTitle}
          prefix={dmMode ? '@' : '#'}
          currentUserId={user?.id ?? null}
        />
      ) : (
        <section className="flex flex-1 items-center justify-center bg-ink-950 p-6 text-center text-sm text-ink-500">
          <div>
            <ErrorNotice message={dmError ?? serverError} />
            <p className="mt-2">
              {dmMode
                ? 'Kies links een gesprek, of begin er een nieuwe.'
                : serverChannelsLoading
                  ? 'Kanalen laden…'
                  : 'Deze server heeft nog geen kanaal.'}
            </p>
            <p className="mt-2 text-xs">
              Berichten worden in je browser versleuteld. De server ziet alleen ciphertext.
            </p>
          </div>
        </section>
      )}

      {showNewDm ? (
        <NewDmDialog
          onClose={() => setShowNewDm(false)}
          onStart={startDm}
          onStarted={(channelId) => navigate(`/dm/${channelId}`)}
        />
      ) : null}

      {showCreateServer ? (
        <CreateServerDialog
          onClose={() => setShowCreateServer(false)}
          onCreate={createServer}
          onJoin={joinServer}
          onCreated={(serverId) => navigate(`/server/${serverId}`)}
        />
      ) : null}

      {showCreateChannel && activeServer ? (
        <CreateChannelDialog
          onClose={() => setShowCreateChannel(false)}
          onCreate={createChannel}
          onCreated={(channelId) => navigate(`/server/${activeServer.id}/${channelId}`)}
        />
      ) : null}
    </div>
  );

}
