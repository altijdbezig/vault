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
  createChannel: vi.fn(),
  listMyChannels: vi.fn(),
  createDm: vi.fn(),
  getPublicKeysForChannel: vi.fn(),
  getProfileByUsername: vi.fn(),
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  subscribeToChannel: vi.fn(),
  subscribeToAllMessages: vi.fn(),
  trackPresence: vi.fn(),
  fetchUnreadState: vi.fn(),
  markChannelRead: vi.fn(),
}));

vi.mock('../../lib/supabase/servers', () => ({
  listMyServers: mocks.listMyServers,
  listServerChannels: mocks.listServerChannels,
  listServerMembers: mocks.listServerMembers,
  createServer: mocks.createServer,
  joinServer: mocks.joinServer,
  createChannel: mocks.createChannel,
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

const SERVERS: ServerSummary[] = [
  { id: 'srv-1', name: 'Vault HQ', ownerId: 'user-a', role: 'owner' },
  { id: 'srv-2', name: 'Tweede', ownerId: 'user-b', role: 'member' },
];

function channel(id: string, name: string): ChannelSummary {
  return { id, type: 'text', name, members: [], displayName: name };
}

const SERVER_CHANNELS: Record<string, ChannelSummary[]> = {
  'srv-1': [channel('chan-1a', 'algemeen'), channel('chan-1b', 'random')],
  'srv-2': [channel('chan-2a', 'welkom')],
};

const DM_CHANNELS: ChannelSummary[] = [
  {
    id: 'dm-1',
    type: 'dm',
    name: null,
    members: [{ userId: 'user-b', username: 'jayden' }],
    displayName: 'jayden',
  },
];

const MEMBERS: ServerMember[] = [
  { userId: 'user-a', username: 'benjamin', role: 'owner', fingerprint: 'aa' },
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
    renderShell('/join/srv-2');

    await waitFor(() => expect(mocks.joinServer).toHaveBeenCalledWith('srv-2'));
    // Straight into the server, not back to a form asking for an id.
    await waitFor(() => expect(mocks.fetchMessages).toHaveBeenCalledWith('chan-2a'));
    expect(screen.getByRole('heading', { name: 'Kanalen' })).toBeTruthy();
  });

  it('joins once, even though effects run twice in development', async () => {
    renderShell('/join/srv-2');

    await waitFor(() => expect(mocks.joinServer).toHaveBeenCalled());
    await settle();

    expect(mocks.joinServer).toHaveBeenCalledTimes(1);
  });

  it('explains a broken invite instead of dropping you on a blank screen', async () => {
    mocks.joinServer.mockRejectedValueOnce(new Error('server bestaat niet'));

    renderShell('/join/srv-2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Deze uitnodiging werkt niet' })).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Terug naar je gesprekken' })).toBeTruthy();
  });
});
