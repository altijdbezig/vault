import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countsAsUnread, fetchUnreadState } from '../unread';

interface QueryResult {
  data: unknown;
  error: unknown;
}

interface QueryBuilder extends PromiseLike<QueryResult> {
  eq(column: string, value: string): QueryBuilder;
  is(column: string, value: unknown): QueryBuilder;
  gt(column: string, value: string): QueryBuilder;
  order(column: string, options?: unknown): QueryBuilder;
  limit(count: number): QueryBuilder;
  returns(): QueryBuilder;
}

const state = vi.hoisted(() => ({
  selects: [] as { table: string; filters: [string, unknown][] }[],
  results: new Map<string, QueryResult>(),
}));

vi.mock('../client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'me' } } },
        error: null,
      }),
    },
    from: (table: string) => ({
      select: () => {
        const record: { table: string; filters: [string, unknown][] } = { table, filters: [] };
        state.selects.push(record);
        const promise = Promise.resolve(state.results.get(table) ?? { data: [], error: null });
        const builder: QueryBuilder = {
          eq: (column, value) => {
            record.filters.push([column, value]);
            return builder;
          },
          is: (column, value) => {
            record.filters.push([column, value]);
            return builder;
          },
          gt: (column, value) => {
            record.filters.push([`gt:${column}`, value]);
            return builder;
          },
          order: () => builder,
          limit: () => builder,
          returns: () => builder,
          then: (onFulfilled, onRejected) => promise.then(onFulfilled, onRejected),
        };
        return builder;
      },
    }),
  },
}));

const OLD = '2026-09-08T09:00:00.000Z';
const NEW = '2026-09-08T12:00:00.000Z';

beforeEach(() => {
  state.selects = [];
  state.results.clear();
});

describe('countsAsUnread', () => {
  it('never counts your own messages, however new they are', () => {
    expect(countsAsUnread({ sender_id: 'me', created_at: NEW }, 'me', OLD)).toBe(false);
  });

  it('counts a message from someone else sent after you last read', () => {
    expect(countsAsUnread({ sender_id: 'other', created_at: NEW }, 'me', OLD)).toBe(true);
  });

  it('does not count a message you have already read', () => {
    expect(countsAsUnread({ sender_id: 'other', created_at: OLD }, 'me', NEW)).toBe(false);
  });
});

describe('fetchUnreadState', () => {
  beforeEach(() => {
    state.results.set('channel_members', {
      data: [
        { channel_id: 'chan-1', last_read_at: OLD, channels: { server_id: 'srv-1' } },
        { channel_id: 'dm-1', last_read_at: OLD, channels: { server_id: null } },
      ],
      error: null,
    });
  });

  it('counts messages from other people and skips your own', async () => {
    state.results.set('messages', {
      data: [
        { channel_id: 'chan-1', sender_id: 'other', created_at: NEW },
        { channel_id: 'chan-1', sender_id: 'me', created_at: NEW },
        { channel_id: 'chan-1', sender_id: 'other', created_at: NEW },
        { channel_id: 'dm-1', sender_id: 'me', created_at: NEW },
      ],
      error: null,
    });

    const { counts, channelServers } = await fetchUnreadState();

    // Two of the three in chan-1; the third was ours. Everything in dm-1 was
    // ours, so it stays at zero rather than disappearing from the map.
    expect(counts).toEqual({ 'chan-1': 2, 'dm-1': 0 });
    expect(channelServers).toEqual({ 'chan-1': 'srv-1', 'dm-1': null });
  });

  it('ignores messages older than your read marker for that channel', async () => {
    state.results.set('channel_members', {
      data: [
        { channel_id: 'chan-1', last_read_at: OLD, channels: { server_id: 'srv-1' } },
        { channel_id: 'chan-2', last_read_at: NEW, channels: { server_id: 'srv-1' } },
      ],
      error: null,
    });
    // One query covers every channel, so chan-2 gets rows it has already read.
    state.results.set('messages', {
      data: [
        { channel_id: 'chan-1', sender_id: 'other', created_at: NEW },
        { channel_id: 'chan-2', sender_id: 'other', created_at: '2026-09-08T10:00:00.000Z' },
      ],
      error: null,
    });

    const { counts } = await fetchUnreadState();

    expect(counts).toEqual({ 'chan-1': 1, 'chan-2': 0 });
  });

  it('asks the database only for your own memberships, and only once', async () => {
    state.results.set('messages', { data: [], error: null });

    await fetchUnreadState();

    expect(state.selects.map((select) => select.table)).toEqual(['channel_members', 'messages']);
    expect(state.selects[0]?.filters).toContainEqual(['user_id', 'me']);
    // Scanned from the oldest read marker, not from the beginning of time.
    expect(state.selects[1]?.filters).toContainEqual(['gt:created_at', OLD]);
  });

  it('does not go looking for messages when you are in no channels at all', async () => {
    state.results.set('channel_members', { data: [], error: null });

    const { counts } = await fetchUnreadState();

    expect(counts).toEqual({});
    expect(state.selects.map((select) => select.table)).toEqual(['channel_members']);
  });
});
