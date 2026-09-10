import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { AppProviders } from '../../App';
import type { ChannelSummary, ServerMember, ServerSummary } from '../../types';
import { AppShell } from '../AppShell';

const mocks = vi.hoisted(() => ({
  listMyServers: vi.fn(),
  listServerChannels: vi.fn(),
  listServerMembers: vi.fn(),
  createServer: vi.fn(),
  joinServer: vi.fn(),
  redeemInvite: vi.fn(),
  createChannel: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
  updateChannel: vi.fn(),
  deleteChannel: vi.fn(),
  reorderChannels: vi.fn(),
  setMemberRole: vi.fn(),
  removeServerMember: vi.fn(),
  transferOwnership: vi.fn(),
  leaveServer: vi.fn(),
  createInvite: vi.fn(),
  listInvites: vi.fn(),
  revokeInvite: vi.fn(),
  listMyChannels: vi.fn(),
  createDm: vi.fn(),
  getPublicKeysForChannel: vi.fn(),
  getProfileByUsername: vi.fn(),
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  subscribeToChannel: vi.fn(),
  subscribeToAllMessages: vi.fn(),
  trackPresence: vi.fn(),
  trackTyping: vi.fn(),
  fetchReactions: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
  subscribeToReactions: vi.fn(),
  fetchUnreadState: vi.fn(),
  markChannelRead: vi.fn(),
}));

vi.mock('../../lib/supabase/servers', () => ({
  listMyServers: mocks.listMyServers,
  listServerChannels: mocks.listServerChannels,
  listServerMembers: mocks.listServerMembers,
  createServer: mocks.createServer,
  joinServer: mocks.joinServer,
  redeemInvite: mocks.redeemInvite,
  createChannel: mocks.createChannel,
  updateServer: mocks.updateServer,
  deleteServer: mocks.deleteServer,
  updateChannel: mocks.updateChannel,
  deleteChannel: mocks.deleteChannel,
  reorderChannels: mocks.reorderChannels,
  setMemberRole: mocks.setMemberRole,
  removeServerMember: mocks.removeServerMember,
  transferOwnership: mocks.transferOwnership,
  leaveServer: mocks.leaveServer,
  createInvite: mocks.createInvite,
  listInvites: mocks.listInvites,
  revokeInvite: mocks.revokeInvite,
}));

vi.mock('../../lib/supabase/channels', () => ({
  listMyChannels: mocks.listMyChannels,
  createDm: mocks.createDm,
}));

vi.mock('../../lib/supabase/profiles', () => ({
  getPublicKeysForChannel: mocks.getPublicKeysForChannel,
  getProfileByUsername: mocks.getProfileByUsername,
}));

vi.mock('../../lib/supabase/messages', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMessages: mocks.fetchMessages,
  sendMessage: mocks.sendMessage,
  subscribeToChannel: mocks.subscribeToChannel,
  subscribeToAllMessages: mocks.subscribeToAllMessages,
}));

vi.mock('../../lib/supabase/presence', () => ({
  trackPresence: mocks.trackPresence,
}));

/**
 * Reactions and typing have to be mocked here for the same reason presence and
 * messages already are: they open a real Realtime socket.
 *
 * ConversationView calls useReactions, which runs subscribeToReactions() and
 * ends in supabase.channel('message_reactions:all').subscribe(). Measured on
 * 10-09-2026 by wrapping supabase.channel: this one file opened 19 real
 * channels. Against the dummy URL from .env.test each becomes an undici
 * WebSocket that connects asynchronously and settles after the test that
 * started it has already finished.
 *
 * When it settles, undici fires an Event from Node's realm at a target from
 * jsdom's realm. The instanceof check across that boundary fails and vitest
 * reports it as an unhandled error:
 *
 *   TypeError: The "event" argument must be an instance of Event.
 *   Received an instance of Event
 *
 * Every test still passes and the run still exits 1. It is a race, so a slower
 * machine loses it where a faster one wins — it showed up on the build machine
 * and never here. Same class of realm mismatch as the Uint8Array alignment in
 * src/test/setup-jsdom.ts.
 *
 * The three plain queries are mocked alongside the subscription so this test
 * makes no network call at all, instead of firing REST requests at a dummy
 * host and leaning on the hook to swallow the failure.
 */
vi.mock('../../lib/supabase/reactions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchReactions: mocks.fetchReactions,
  addReaction: mocks.addReaction,
  removeReaction: mocks.removeReaction,
  subscribeToReactions: mocks.subscribeToReactions,
}));

/*
 * Typing opened no socket in this run, because useTyping only joins the room
 * when the typingIndicator setting is on and these tests start from a cleared
 * localStorage. It is mocked anyway: the moment a test flips that setting on,
 * trackTyping() opens `typing:<channelId>` per channel and this file is back to
 * the same failure, in a spot that has nothing to do with what it was testing.
 *
 * importOriginal keeps TYPING_TIMEOUT_MS and TYPING_THROTTLE_MS real, because
 * useTyping does its pruning arithmetic with them.
 */
vi.mock('../../lib/supabase/typing', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  trackTyping: mocks.trackTyping,
}));

vi.mock('../../lib/supabase/unread', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchUnreadState: mocks.fetchUnreadState,
  markChannelRead: mocks.markChannelRead,
}));

vi.mock('../../hooks/useAuth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'user-a' },
    profile: { id: 'user-a', username: 'benjamin', publicKey: '', fingerprint: 'aa' },
    signOut: vi.fn(),
    exportEncryptedKey: vi.fn(),
    lock: vi.fn(),
  }),
}));

/**
 * Realistic ids for the second server.
 *
 * /join accepts two shapes now, and it tells them apart: a uuid is an older
 * direct-join link, anything matching the invite-code pattern goes through the
 * database function. A made-up id like "srv-2" is neither, so these tests
 * would be testing the rejection path rather than the join.
 */
const SERVER_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INVITE_CODE = 'a1b2c3d4e5';

const SERVERS: ServerSummary[] = [
  { id: 'srv-1', name: 'Vault HQ', ownerId: 'user-a', role: 'owner', iconUrl: null },
  { id: SERVER_2, name: 'Tweede', ownerId: 'user-b', role: 'member', iconUrl: null },
];

function channel(id: string, name: string): ChannelSummary {
  return {
    id,
    type: 'text',
    name,
    members: [],
    displayName: name,
    description: null,
    position: 0,
  };
}

const SERVER_CHANNELS: Record<string, ChannelSummary[]> = {
  'srv-1': [channel('chan-1a', 'algemeen'), channel('chan-1b', 'random')],
  [SERVER_2]: [channel('chan-2a', 'welkom')],
};

const DM_CHANNELS: ChannelSummary[] = [
  {
    id: 'dm-1',
    type: 'dm',
    name: null,
    members: [{ userId: 'user-b', username: 'jayden' }],
    displayName: 'jayden',
    description: null,
    position: 0,
  },
];

const MEMBERS: ServerMember[] = [
  {
    userId: 'user-a',
    username: 'benjamin',
    role: 'owner',
    fingerprint: 'aa',
    displayName: null,
    avatarUrl: null,
  },
];

/** Lets a test press the browser back button. */
let goBack: () => void = () => {};

function BackHandle() {
  const navigate = useNavigate();
  goBack = () => navigate(-1);
  return null;
}

function renderShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BackHandle />
      <AppProviders>
        <AppShell />
      </AppProviders>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  mocks.listMyServers.mockResolvedValue(SERVERS);
  mocks.listServerChannels.mockImplementation(
    async (serverId: string) => SERVER_CHANNELS[serverId] ?? [],
  );
  mocks.listServerMembers.mockResolvedValue(MEMBERS);
  mocks.listMyChannels.mockResolvedValue(DM_CHANNELS);
  mocks.getPublicKeysForChannel.mockResolvedValue([]);
  mocks.fetchMessages.mockResolvedValue([]);
  mocks.subscribeToChannel.mockReturnValue(() => {});
  mocks.subscribeToAllMessages.mockReturnValue(() => {});
  mocks.trackPresence.mockReturnValue(() => {});
  // A TypingChannel: useTyping calls close() on cleanup, so it has to be there.
  mocks.trackTyping.mockReturnValue({
    announce: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
  });
  mocks.fetchReactions.mockResolvedValue([]);
  mocks.addReaction.mockResolvedValue(undefined);
  mocks.removeReaction.mockResolvedValue(undefined);
  mocks.subscribeToReactions.mockReturnValue(() => {});
  mocks.fetchUnreadState.mockResolvedValue({ counts: {}, channelServers: {} });
  mocks.markChannelRead.mockResolvedValue(undefined);
  mocks.joinServer.mockResolvedValue(undefined);
});

function dmButton(): HTMLElement {
  return screen.getByTitle('Directe berichten');
}

function serverButton(name: string): HTMLElement {
  return screen.getByTitle(name);
}

/** Lets any effect that was going to fire, fire, before counting calls. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('A1 — navigating between DM mode and server mode', () => {
  it('goes back to the conversation list from a server channel', async () => {
    renderShell('/server/srv-1/chan-1a');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Kanalen' })).toBeTruthy());

    fireEvent.click(dmButton());

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Gesprekken' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Kanalen' })).toBeNull();
    expect(screen.getByText('jayden')).toBeTruthy();
  });

  it('lights up the DM button in DM mode and the server icon in a server', async () => {
    renderShell('/server/srv-1/chan-1a');

    await waitFor(() => expect(serverButton('Vault HQ').getAttribute('aria-current')).toBe('page'));
    expect(dmButton().getAttribute('aria-current')).toBeNull();

    fireEvent.click(dmButton());

    await waitFor(() => expect(dmButton().getAttribute('aria-current')).toBe('page'));
    expect(serverButton('Vault HQ').getAttribute('aria-current')).toBeNull();
  });

  it('opens a DM from the conversation list', async () => {
    renderShell('/dm');

    await waitFor(() => expect(screen.getByText('jayden')).toBeTruthy());
    fireEvent.click(screen.getByText('jayden'));

    await waitFor(() => expect(mocks.fetchMessages).toHaveBeenCalledWith('dm-1'));
  });

  it('survives the browser back button in both directions', async () => {
    renderShell('/dm/dm-1');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Gesprekken' })).toBeTruthy());

    fireEvent.click(serverButton('Vault HQ'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Kanalen' })).toBeTruthy());

    fireEvent.click(dmButton());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Gesprekken' })).toBeTruthy());

    // Back to the server we came from, not to a blank screen.
    goBack();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Kanalen' })).toBeTruthy());

    goBack();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Gesprekken' })).toBeTruthy());
  });

  it('switches between two servers without stranding you on the wrong channel', async () => {
    renderShell('/server/srv-1/chan-1a');
    await waitFor(() => expect(screen.getByPlaceholderText('Bericht aan #algemeen')).toBeTruthy());

    fireEvent.click(serverButton('Tweede'));

    await waitFor(() => expect(screen.getByPlaceholderText('Bericht aan #welkom')).toBeTruthy());
    await settle();

    // chan-1a belongs to the other server; it must never be opened here.
    expect(mocks.fetchMessages.mock.calls.map((call) => call[0])).toEqual(['chan-1a', 'chan-2a']);
  });
});

describe('A2 — one fetch per channel switch', () => {
  it('fetches messages and members exactly once when opening a channel', async () => {
    renderShell('/server/srv-1/chan-1a');
    await waitFor(() => expect(screen.getByText('random')).toBeTruthy());
    await waitFor(() => expect(mocks.fetchMessages).toHaveBeenCalled());
    await settle();

    mocks.fetchMessages.mockClear();
    mocks.getPublicKeysForChannel.mockClear();
    mocks.listServerChannels.mockClear();
    mocks.listServerMembers.mockClear();
    mocks.listMyChannels.mockClear();
    mocks.listMyServers.mockClear();

    fireEvent.click(screen.getByText('random'));

    await waitFor(() => expect(mocks.fetchMessages).toHaveBeenCalledWith('chan-1b'));
    await settle();

    expect(mocks.fetchMessages).toHaveBeenCalledTimes(1);
    expect(mocks.getPublicKeysForChannel).toHaveBeenCalledTimes(1);
    // Same server: its channel and member lists must not be refetched at all.
    expect(mocks.listServerChannels).toHaveBeenCalledTimes(0);
    expect(mocks.listServerMembers).toHaveBeenCalledTimes(0);
    expect(mocks.listMyServers).toHaveBeenCalledTimes(0);
    expect(mocks.listMyChannels).toHaveBeenCalledTimes(0);
  });

  it('fetches each list exactly once when switching to another server', async () => {
    renderShell('/server/srv-1/chan-1a');
    await waitFor(() => expect(mocks.fetchMessages).toHaveBeenCalled());
    await settle();

    mocks.fetchMessages.mockClear();
    mocks.getPublicKeysForChannel.mockClear();
    mocks.listServerChannels.mockClear();
    mocks.listServerMembers.mockClear();

    fireEvent.click(serverButton('Tweede'));

    await waitFor(() => expect(mocks.fetchMessages).toHaveBeenCalledWith('chan-2a'));
    await settle();

    expect(mocks.listServerChannels).toHaveBeenCalledTimes(1);
    expect(mocks.listServerMembers).toHaveBeenCalledTimes(1);
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(1);
    expect(mocks.getPublicKeysForChannel).toHaveBeenCalledTimes(1);
  });
});

describe('C — one column at a time on a phone', () => {
  /** Puts the window below the md breakpoint and lets the app react. */
  function narrow(): void {
    window.innerWidth = 390;
    window.dispatchEvent(new Event('resize'));
  }

  function wide(): void {
    window.innerWidth = 1024;
    window.dispatchEvent(new Event('resize'));
  }

  afterEach(wide);

  it('shows the channel list of a server instead of jumping into its first channel', async () => {
    narrow();
    renderShell('/dm');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Gesprekken' })).toBeTruthy());

    // The rail is a drawer here, so it has to be opened first.
    fireEvent.click(screen.getByRole('button', { name: /Servers/ }));
    fireEvent.click(serverButton('Vault HQ'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Kanalen' })).toBeTruthy());
    await settle();

    // On a phone the channel list is the destination; opening a channel is a
    // second tap, and that is what the back button goes back to.
    expect(mocks.fetchMessages).not.toHaveBeenCalled();
  });

  it('goes back to the list from a conversation', async () => {
    narrow();
    renderShell('/server/srv-1/chan-1a');

    await waitFor(() => expect(screen.getByPlaceholderText('Bericht aan #algemeen')).toBeTruthy());

    // Which of the two columns is on screen is decided in CSS, which jsdom
    // does not apply, so this checks the navigation underneath it: back lands
    // on the server without a channel, and the conversation is unmounted.
    fireEvent.click(screen.getByLabelText('Terug naar de lijst'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Kanalen' })).toBeTruthy());
    expect(screen.queryByPlaceholderText('Bericht aan #algemeen')).toBeNull();
  });

  it('still opens the first channel of a server on a wide screen', async () => {
    renderShell('/dm');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Gesprekken' })).toBeTruthy());

    fireEvent.click(serverButton('Vault HQ'));

    // The opposite of the phone case: with room for both columns, landing on
    // an empty pane would be a wasted click.
    await waitFor(() => expect(mocks.fetchMessages).toHaveBeenCalledWith('chan-1a'));
    expect(screen.getByRole('heading', { name: 'Kanalen' })).toBeTruthy();
  });
});

describe('D4 — invite links', () => {
  it('joins the server and opens it', async () => {
    renderShell(`/join/${SERVER_2}`);

    await waitFor(() => expect(mocks.joinServer).toHaveBeenCalledWith(SERVER_2));
    // Straight into the server, not back to a form asking for an id.
    await waitFor(() => expect(mocks.fetchMessages).toHaveBeenCalledWith('chan-2a'));
    expect(screen.getByRole('heading', { name: 'Kanalen' })).toBeTruthy();
  });

  it('joins once, even though effects run twice in development', async () => {
    renderShell(`/join/${SERVER_2}`);

    await waitFor(() => expect(mocks.joinServer).toHaveBeenCalled());
    await settle();

    expect(mocks.joinServer).toHaveBeenCalledTimes(1);
  });

  it('explains a broken invite instead of dropping you on a blank screen', async () => {
    mocks.joinServer.mockRejectedValueOnce(new Error('server bestaat niet'));

    renderShell(`/join/${SERVER_2}`);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Deze uitnodiging werkt niet' })).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Terug naar je gesprekken' })).toBeTruthy();
  });

  it('wisselt een uitnodigingscode in via de databasefunctie', async () => {
    // Een code is geen server-id, en de client mag de invite-rij niet lezen.
    // Inwisselen gaat daarom via redeem_server_invite, dat het server-id
    // teruggeeft waar we naartoe moeten.
    mocks.redeemInvite.mockResolvedValue(SERVER_2);

    renderShell(`/join/${INVITE_CODE}`);

    await waitFor(() => expect(mocks.redeemInvite).toHaveBeenCalledWith(INVITE_CODE));
    expect(mocks.joinServer).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.fetchMessages).toHaveBeenCalledWith('chan-2a'));
  });

  it('legt een onbruikbare link uit zonder de database aan te tikken', async () => {
    // "srv-2" is geen uuid en geen geldige code. Dat lokaal afkeuren geeft een
    // nette melding in plaats van een databasefout.
    renderShell('/join/srv-2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Deze uitnodiging werkt niet' })).toBeTruthy(),
    );
    expect(mocks.joinServer).not.toHaveBeenCalled();
    expect(mocks.redeemInvite).not.toHaveBeenCalled();
  });
});
