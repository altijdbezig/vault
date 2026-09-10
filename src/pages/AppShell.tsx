import { useEffect, useRef, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { AddGroupMemberDialog } from '../components/AddGroupMemberDialog';
import { Button } from '../components/Button';
import { ChannelList } from '../components/ChannelList';
import { ChannelSidebar } from '../components/ChannelSidebar';
import { CreateChannelDialog } from '../components/CreateChannelDialog';
import { CreateServerDialog } from '../components/CreateServerDialog';
import { Avatar } from '../components/Avatar';
import { ErrorNotice } from '../components/ErrorNotice';
import { IconButton } from '../components/IconButton';
import { NewDmDialog } from '../components/NewDmDialog';
import { NewGroupDialog } from '../components/NewGroupDialog';
import { Modal } from '../components/Modal';
import { ProfileCard } from '../components/ProfileCard';
import { ServerRail } from '../components/ServerRail';
import { useAuth } from '../hooks/useAuth';
import { useChannels } from '../hooks/useChannels';
import { useIsWideScreen } from '../hooks/useMediaQuery';
import { useServerChannels, useServers } from '../hooks/useServers';
import { useUnread } from '../hooks/useUnread';
import { describeError } from '../lib/errorMessages';
import { inviteTokenFromInput } from '../lib/invite';
import type { ChannelType } from '../types';
import { ConversationView } from './ConversationView';
import { ServerSettingsDialog } from './ServerSettingsDialog';
import { SettingsDialog } from './SettingsDialog';

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
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Routes: /dm, /dm/:channelId, /server/:serverId, /server/:serverId/:channelId
  //
  // /dm exists as a route of its own so the DM button has somewhere to go.
  // Sending it to "/" instead put it straight back into the redirect below,
  // which bounced it into the server it had just left.
  const joinMatch = useMatch('/join/:token');
  const dmMatch = useMatch('/dm/:channelId');
  const serverMatch = useMatch('/server/:serverId');
  const serverChannelMatch = useMatch('/server/:serverId/:channelId');

  const activeServerId =
    serverChannelMatch?.params.serverId ?? serverMatch?.params.serverId ?? null;
  const activeChannelId =
    serverChannelMatch?.params.channelId ?? dmMatch?.params.channelId ?? null;
  const dmMode = activeServerId === null;

  const {
    channels: dmChannels,
    loading: dmLoading,
    error: dmError,
    startDm,
    startGroup,
    addToGroup,
    leaveGroup,
  } = useChannels();
  const {
    servers,
    createServer,
    joinServer,
    joinByCode,
    updateServer,
    deleteServer,
    leaveServer,
    transferOwnership,
  } = useServers();
  const { counts: unread, serverHasUnread, setActiveChannel } = useUnread();
  const wide = useIsWideScreen();

  const activeServer = servers.find((server) => server.id === activeServerId) ?? null;
  const {
    channels: serverChannels,
    members: serverMembers,
    loading: serverChannelsLoading,
    error: serverError,
    canCreateChannel,
    createChannel,
    updateChannel,
    deleteChannel,
    reorder,
    canManageMembers,
    setRole,
    removeMember,
  } = useServerChannels(activeServerId, activeServer?.role ?? null);

  const [showNewDm, setShowNewDm] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [confirmLeaveServer, setConfirmLeaveServer] = useState(false);
  /** The profile card that is open, by user id. */
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  /** Mobile only: the server rail is a drawer there, not a column. */
  const [showRail, setShowRail] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  /** Invite ids already handled, so StrictMode cannot join twice. */
  const handledInvites = useRef(new Set<string>());

  /*
   * Following an invite link.
   *
   * /join/:serverId is reachable while signed out too: the URL survives the
   * sign-in screen, so this runs the moment the app is unlocked and drops the
   * user in the server rather than making them find it.
   */
  const inviteToken = joinMatch?.params.token ?? null;
  useEffect(() => {
    if (!inviteToken || handledInvites.current.has(inviteToken)) {
      return;
    }
    handledInvites.current.add(inviteToken);

    void (async () => {
      try {
        // Two shapes of link. A bare server id is an older link and joins
        // directly; an invite code goes through the database function, which
        // is the only thing allowed to read the invite row.
        const parsed = inviteTokenFromInput(inviteToken);
        if (!parsed) {
          setJoinError('Deze uitnodigingslink is niet geldig.');
          return;
        }

        if (parsed.kind === 'serverId') {
          await joinServer(parsed.value);
          navigate(`/server/${parsed.value}`, { replace: true });
          return;
        }

        const serverId = await joinByCode(parsed.value);
        navigate(`/server/${serverId}`, { replace: true });
      } catch (caught) {
        console.error('Kon niet joinen via uitnodiging:', caught);
        setJoinError(describeError(caught));
      }
    })();
  }, [inviteToken, joinServer, joinByCode, navigate]);

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
  //
  // Only on a wide screen. On a phone one column is on screen at a time, so
  // opening a server has to show its channel list; jumping straight into a
  // channel would leave the back button nowhere to go.
  const firstChannelId = serverChannels[0]?.id ?? null;
  useEffect(() => {
    if (!wide || !serverMatch || serverChannelsLoading || !firstChannelId) {
      return;
    }
    navigate(`/server/${serverMatch.params.serverId}/${firstChannelId}`, { replace: true });
  }, [navigate, firstChannelId, serverChannelsLoading, serverMatch, wide]);

  // The provider needs to know what is on screen to stop counting it as
  // unread and to move the read marker.
  useEffect(() => {
    setActiveChannel(activeChannelId);
  }, [activeChannelId, setActiveChannel]);

  /** The DM button: back to your last conversation, or the list. */
  function goToDmMode(): void {
    const last = readStored(LAST_DM_PATH_KEY);
    const stillExists =
      last !== null && dmChannels.some((channel) => last === `/dm/${channel.id}`);
    navigate(stillExists && last ? last : '/dm');
  }

  // Anything unread that is not in a server belongs to the DM button.
  const dmUnreadTotal = dmChannels.reduce(
    (total, channel) => total + (unread[channel.id] ?? 0),
    0,
  );

  const activeChannel =
    (dmMode ? dmChannels : serverChannels).find((channel) => channel.id === activeChannelId) ??
    null;
  const activeChannelTitle =
    activeChannel?.displayName ?? (dmMode ? 'gesprek' : 'kanaal');
  const activeChannelType: ChannelType = activeChannel?.type ?? (dmMode ? 'dm' : 'text');
  const inGroup = activeChannelType === 'group';

  /** Mobile back button: from a conversation to the list it came from. */
  function goToList(): void {
    navigate(activeServerId ? `/server/${activeServerId}` : '/dm');
  }

  async function handleLeaveGroup(): Promise<void> {
    if (!activeChannelId) {
      return;
    }
    await leaveGroup(activeChannelId);
    navigate('/dm');
  }


  if (inviteToken) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-sm text-center">
          {joinError ? (
            <>
              <h1 className="text-sm font-semibold text-primary">
                Deze uitnodiging werkt niet
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted">{joinError}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Vraag degene die hem stuurde om een nieuwe link, of om het
                server-id.
              </p>
              <Button
                variant="ghost"
                className="mt-4 w-full"
                onClick={() => {
                  navigate('/dm', { replace: true });
                }}
              >
                Terug naar je gesprekken
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted">Bezig met lid worden…</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Tapping outside the rail drawer closes it. Mobile only. */}
      {showRail ? (
        <button
          type="button"
          aria-label="Serverlijst sluiten"
          onClick={() => setShowRail(false)}
          className="absolute inset-0 z-20 bg-scrim md:hidden"
        />
      ) : null}

      <div
        className={`${showRail ? 'absolute inset-y-0 left-0 z-30 flex' : 'hidden'} md:static md:z-auto md:flex`}
      >
        <ServerRail
          servers={servers}
          activeServerId={activeServerId}
          dmActive={dmMode}
          onSelectDm={() => {
            setShowRail(false);
            goToDmMode();
          }}
          onSelectServer={(serverId) => {
            setShowRail(false);
            navigate(`/server/${serverId}`);
          }}
          onCreateServer={() => {
            setShowRail(false);
            setShowCreateServer(true);
          }}
          hasUnread={serverHasUnread}
          dmUnread={dmUnreadTotal}
        />
      </div>

      <aside
        className={`${activeChannelId ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-subtle bg-raised md:w-60 md:shrink-0`}
      >
        <button
          type="button"
          onClick={() => setShowRail(true)}
          className="flex min-h-11 items-center gap-2 border-b border-subtle px-3 text-left text-sm text-secondary hover:bg-hover md:hidden"
        >
          <span aria-hidden="true">☰</span> Servers
          {dmUnreadTotal > 0 || servers.some((server) => serverHasUnread(server.id)) ? (
            <span
              aria-label="ongelezen elders"
              className="h-2 w-2 rounded-full bg-accent"
            />
          ) : null}
        </button>

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
            unread={unread}
            onOpenSettings={() => setShowServerSettings(true)}
            onLeaveServer={
              // Absent for the owner on purpose: leaving would strand the
              // server, so the offer is transfer or delete, in settings.
              activeServer.role === 'owner' ? undefined : () => setConfirmLeaveServer(true)
            }
          />
        ) : (
          <ChannelList
            channels={dmChannels}
            activeId={activeChannelId}
            loading={dmLoading}
            onSelect={(channelId) => navigate(`/dm/${channelId}`)}
            onNewDm={() => setShowNewDm(true)}
            onNewGroup={() => setShowNewGroup(true)}
            unread={unread}
          />
        )}

        {/*
          * The account row.
          *
          * Your own avatar and name open your profile card (which is where
          * your fingerprint lives), and the gear opens settings. The
          * fingerprint, the export and the theme switch used to be a panel
          * that unfolded here; they moved into settings, where the rest of
          * the choices are, so there is one place to look instead of two.
          */}
        <div className="flex items-center gap-1 border-t border-subtle p-2">
          <button
            type="button"
            onClick={() => setProfileUserId(user?.id ?? null)}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-hover"
          >
            <Avatar
              userId={user?.id ?? 'onbekend'}
              name={profile?.displayName ?? profile?.username ?? ''}
              url={profile?.avatarUrl}
              size="sm"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-primary">
                {profile?.displayName ?? profile?.username}
              </span>
              {profile?.displayName ? (
                <span className="block truncate text-2xs text-muted">
                  @{profile.username}
                </span>
              ) : null}
            </span>
          </button>

          <IconButton label="Instellingen" onClick={() => setShowSettings(true)}>
            ⚙
          </IconButton>
          <IconButton
            label="Uitloggen"
            onClick={() => {
              void signOut();
            }}
          >
            ⏻
          </IconButton>
        </div>
      </aside>

      {activeChannelId ? (
        <ConversationView
          key={activeChannelId}
          channelId={activeChannelId}
          title={activeChannelTitle}
          channelType={activeChannelType}
          description={activeChannel?.description ?? null}
          currentUserId={user?.id ?? null}
          onBack={goToList}
          onOpenProfile={(userId) => setProfileUserId(userId)}
          onAddMember={inGroup ? () => setShowAddMember(true) : undefined}
          onLeaveGroup={
            inGroup
              ? () => {
                  void handleLeaveGroup();
                }
              : undefined
          }
        />
      ) : (
        <section className="hidden flex-1 items-center justify-center bg-base p-6 text-center text-sm text-muted md:flex">
          <div>
            <ErrorNotice message={dmError ?? serverError} />
            <p className="mt-2">
              {!dmMode
                ? serverChannelsLoading
                  ? 'Kanalen laden…'
                  : 'Deze server heeft nog geen kanaal.'
                : dmLoading
                  ? 'Gesprekken laden…'
                  : dmChannels.length === 0
                    ? 'Je hebt nog geen gesprekken. Begin er een met + links, of maak een groep.'
                    : 'Kies links een gesprek, of begin er een nieuwe.'}
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

      {showNewGroup ? (
        <NewGroupDialog
          onClose={() => setShowNewGroup(false)}
          onCreate={startGroup}
          onCreated={(channelId) => navigate(`/dm/${channelId}`)}
        />
      ) : null}

      {showAddMember && activeChannelId ? (
        <AddGroupMemberDialog
          groupName={activeChannelTitle}
          onClose={() => setShowAddMember(false)}
          onAdd={(username) => addToGroup(activeChannelId, username)}
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

      {showServerSettings && activeServer ? (
        <ServerSettingsDialog
          server={activeServer}
          channels={serverChannels}
          members={serverMembers}
          currentUserId={user?.id ?? null}
          canManageMembers={canManageMembers}
          onClose={() => setShowServerSettings(false)}
          onUpdateServer={(input) => updateServer(activeServer.id, input)}
          onDeleteServer={async () => {
            await deleteServer(activeServer.id);
            // The server is gone, so staying on its URL would render an empty
            // shell with a dead sidebar.
            navigate('/dm', { replace: true });
          }}
          onUpdateChannel={updateChannel}
          onDeleteChannel={async (channelId) => {
            await deleteChannel(channelId);
            if (channelId === activeChannelId) {
              navigate(`/server/${activeServer.id}`, { replace: true });
            }
          }}
          onReorder={reorder}
          onSetRole={setRole}
          onRemoveMember={removeMember}
          onTransferOwnership={(userId) => transferOwnership(activeServer.id, userId)}
        />
      ) : null}

      {confirmLeaveServer && activeServer ? (
        <Modal
          title={`${activeServer.name} verlaten`}
          onClose={() => setConfirmLeaveServer(false)}
        >
          <p className="text-sm leading-relaxed text-secondary">
            Je wordt uit deze server en uit alle kanalen erin verwijderd. Berichten die
            je al ontsleuteld hebt blijven op dit apparaat leesbaar, maar je krijgt
            niets nieuws meer binnen.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Kom je later terug via een uitnodiging, dan kun je de berichten van
            tussenliggende tijd niet meer lezen: die zijn versleuteld voor de leden van
            toen.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              className="bg-danger text-danger-on hover:bg-danger-hover"
              onClick={() => {
                void (async () => {
                  try {
                    await leaveServer(activeServer.id);
                    setConfirmLeaveServer(false);
                    navigate('/dm', { replace: true });
                  } catch (caught) {
                    console.error('Kon de server niet verlaten:', caught);
                    setJoinError(describeError(caught));
                    setConfirmLeaveServer(false);
                  }
                })();
              }}
            >
              Server verlaten
            </Button>
            <Button variant="ghost" onClick={() => setConfirmLeaveServer(false)}>
              Annuleren
            </Button>
          </div>
        </Modal>
      ) : null}

      {showSettings ? (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          // Every channel you are in, so notifications can be muted per
          // channel. DMs are named after the other person, server channels
          // after their server, so two channels called "algemeen" are still
          // told apart.
          channels={[
            ...dmChannels.map((channel) => ({
              id: channel.id,
              label: channel.displayName || 'gesprek',
            })),
            ...servers.flatMap((server) =>
              (server.id === activeServerId ? serverChannels : []).map((channel) => ({
                id: channel.id,
                label: `${server.name} · #${channel.displayName}`,
              })),
            ),
          ]}
        />
      ) : null}

      {profileUserId ? (
        <ProfileCard
          userId={profileUserId}
          isSelf={profileUserId === user?.id}
          onClose={() => setProfileUserId(null)}
          onStartDm={(username) => {
            setProfileUserId(null);
            void (async () => {
              try {
                const channelId = await startDm(username);
                navigate(`/dm/${channelId}`);
              } catch (caught) {
                console.error('Kon geen gesprek beginnen:', caught);
              }
            })();
          }}
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
