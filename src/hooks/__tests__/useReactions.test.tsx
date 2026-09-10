import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelMemberKey, ReactionRow } from '../../types';
import { useReactions } from '../useReactions';
import type { ReactionChange } from '../../lib/supabase/reactions';

const mocks = vi.hoisted(() => ({
  fetchReactions: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
  subscribeToReactions: vi.fn(),
}));

vi.mock('../../lib/supabase/reactions', () => ({
  fetchReactions: mocks.fetchReactions,
  addReaction: mocks.addReaction,
  removeReaction: mocks.removeReaction,
  subscribeToReactions: mocks.subscribeToReactions,
}));

vi.mock('../useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-a' } }),
}));

const CHANNEL_ID = 'channel-1';

const MEMBERS: ChannelMemberKey[] = [
  {
    userId: 'user-a',
    username: 'benjamin',
    publicKey: 'A',
    fingerprint: null,
    displayName: null,
    avatarUrl: null,
  },
  {
    userId: 'user-b',
    username: 'jayden',
    publicKey: 'B',
    fingerprint: null,
    displayName: 'Jayden K.',
    avatarUrl: null,
  },
];

function reaction(messageId: string, userId: string, emoji: string): ReactionRow {
  return {
    message_id: messageId,
    user_id: userId,
    emoji,
    created_at: '2026-09-10T10:00:00.000Z',
  };
}

/** Pushes a realtime change into the hook under test. */
let emit: (change: ReactionChange) => void = () => {};
let unsubscribe = vi.fn();

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  unsubscribe = vi.fn();
  mocks.subscribeToReactions.mockImplementation((onChange: (change: ReactionChange) => void) => {
    emit = onChange;
    return unsubscribe;
  });
  mocks.fetchReactions.mockResolvedValue([]);
  mocks.addReaction.mockResolvedValue(undefined);
  mocks.removeReaction.mockResolvedValue(undefined);
});

describe('loading reactions', () => {
  it('groups per emoji and marks which ones are yours', async () => {
    mocks.fetchReactions.mockResolvedValue([
      reaction('m-1', 'user-b', '👍'),
      reaction('m-1', 'user-a', '👍'),
      reaction('m-1', 'user-b', '🎉'),
    ]);

    const { result } = renderHook(() => useReactions(CHANNEL_ID, ['m-1'], MEMBERS));

    await waitFor(() => expect(result.current.groups['m-1']).toHaveLength(2));

    const [thumbs, party] = result.current.groups['m-1'] ?? [];
    expect(thumbs?.emoji).toBe('👍');
    expect(thumbs?.userIds).toEqual(['user-b', 'user-a']);
    expect(thumbs?.mine).toBe(true);
    expect(party?.mine).toBe(false);
  });

  it('uses the display name in the tooltip list when there is one', async () => {
    mocks.fetchReactions.mockResolvedValue([reaction('m-1', 'user-b', '👍')]);

    const { result } = renderHook(() => useReactions(CHANNEL_ID, ['m-1'], MEMBERS));

    await waitFor(() =>
      expect(result.current.groups['m-1']?.[0]?.usernames).toEqual(['Jayden K.']),
    );
  });

  it('never asks the server about an optimistic local message', async () => {
    // Een rij met een local- id bestaat nog niet op de server; ernaar vragen
    // zou een request zijn die per definitie leeg terugkomt.
    renderHook(() => useReactions(CHANNEL_ID, ['local-abc'], MEMBERS));

    await waitFor(() => expect(mocks.subscribeToReactions).toHaveBeenCalled());
    expect(mocks.fetchReactions).not.toHaveBeenCalled();
  });

  it('only asks about messages it has not seen before', async () => {
    const { rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useReactions(CHANNEL_ID, ids, MEMBERS),
      { initialProps: { ids: ['m-1'] } },
    );

    await waitFor(() => expect(mocks.fetchReactions).toHaveBeenCalledWith(['m-1']));

    // Een pagina ouder berichten erbij: alleen de nieuwe ids worden gevraagd.
    rerender({ ids: ['m-0', 'm-1'] });

    await waitFor(() => expect(mocks.fetchReactions).toHaveBeenCalledTimes(2));
    expect(mocks.fetchReactions).toHaveBeenLastCalledWith(['m-0']);
  });
});

describe('realtime', () => {
  it('adds a reaction from somebody else', async () => {
    const { result } = renderHook(() => useReactions(CHANNEL_ID, ['m-1'], MEMBERS));
    await waitFor(() => expect(mocks.subscribeToReactions).toHaveBeenCalled());

    await act(async () => {
      emit({ type: 'added', row: reaction('m-1', 'user-b', '🎉') });
    });

    expect(result.current.groups['m-1']?.[0]?.emoji).toBe('🎉');
  });

  it('removes one again', async () => {
    mocks.fetchReactions.mockResolvedValue([reaction('m-1', 'user-b', '🎉')]);
    const { result } = renderHook(() => useReactions(CHANNEL_ID, ['m-1'], MEMBERS));
    await waitFor(() => expect(result.current.groups['m-1']).toHaveLength(1));

    await act(async () => {
      emit({ type: 'removed', row: reaction('m-1', 'user-b', '🎉') });
    });

    expect(result.current.groups['m-1']).toBeUndefined();
  });

  it('drops a reaction on a message it does not hold', async () => {
    // Er is geen channel-filter mogelijk op message_reactions, dus alles wat
    // RLS doorlaat komt hier langs.
    const { result } = renderHook(() => useReactions(CHANNEL_ID, ['m-1'], MEMBERS));
    await waitFor(() => expect(mocks.subscribeToReactions).toHaveBeenCalled());

    await act(async () => {
      emit({ type: 'added', row: reaction('m-elders', 'user-b', '👍') });
    });

    expect(result.current.groups['m-elders']).toBeUndefined();
  });

  it('ignores a duplicate of a reaction it already has', async () => {
    mocks.fetchReactions.mockResolvedValue([reaction('m-1', 'user-b', '👍')]);
    const { result } = renderHook(() => useReactions(CHANNEL_ID, ['m-1'], MEMBERS));
    await waitFor(() => expect(result.current.groups['m-1']).toHaveLength(1));

    await act(async () => {
      emit({ type: 'added', row: reaction('m-1', 'user-b', '👍') });
    });

    expect(result.current.groups['m-1']?.[0]?.userIds).toEqual(['user-b']);
  });
});

describe('toggling', () => {
  it('adds your reaction and shows it before the request finishes', async () => {
    let settle: () => void = () => {};
    mocks.addReaction.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );

    const { result } = renderHook(() => useReactions(CHANNEL_ID, ['m-1'], MEMBERS));
    await waitFor(() => expect(mocks.subscribeToReactions).toHaveBeenCalled());

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.toggle('m-1', '👍');
    });

    // Optimistisch: staat er al terwijl de insert nog loopt.
    expect(result.current.groups['m-1']?.[0]?.mine).toBe(true);

    await act(async () => {
      settle();
      await pending;
    });

    expect(mocks.addReaction).toHaveBeenCalledWith('m-1', '👍');
  });

  it('removes it again on a second click', async () => {
    mocks.fetchReactions.mockResolvedValue([reaction('m-1', 'user-a', '👍')]);
    const { result } = renderHook(() => useReactions(CHANNEL_ID, ['m-1'], MEMBERS));
    await waitFor(() => expect(result.current.groups['m-1']).toHaveLength(1));

    await act(async () => {
      await result.current.toggle('m-1', '👍');
    });

    expect(mocks.removeReaction).toHaveBeenCalledWith('m-1', '👍');
    expect(result.current.groups['m-1']).toBeUndefined();
    expect(mocks.addReaction).not.toHaveBeenCalled();
  });

  it('puts the reaction back when the request fails', async () => {
    mocks.addReaction.mockRejectedValue(new Error('403'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useReactions(CHANNEL_ID, ['m-1'], MEMBERS));
    await waitFor(() => expect(mocks.subscribeToReactions).toHaveBeenCalled());

    await act(async () => {
      await result.current.toggle('m-1', '👍');
    });

    // Een emoji die stil niet aankwam is erger dan een die zichtbaar
    // terugveert, dus de optimistische rij wordt teruggedraaid en er komt een
    // melding.
    expect(result.current.groups['m-1']).toBeUndefined();
    expect(result.current.error).toBe('Reactie kon niet opgeslagen worden.');

    errors.mockRestore();
  });
});
