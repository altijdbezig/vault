import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMessages, fetchMessagesSince, MESSAGE_PAGE_SIZE } from '../messages';
import type { MessageRow } from '../../../types';

interface QueryResult {
  data: unknown;
  error: unknown;
}

const state = vi.hoisted(() => ({
  /** One record per query, in the order the code made them. */
  queries: [] as { ascending: boolean; filters: Record<string, unknown>; limit: number }[],
  /** Pages handed back in order; the last one repeats. */
  pages: [] as unknown[][],
}));

vi.mock('../client', () => ({
  supabase: {
    from: () => ({
      select: () => {
        const record = { ascending: true, filters: {} as Record<string, unknown>, limit: 0 };
        state.queries.push(record);

        const page = state.pages.length > 1 ? state.pages.shift() : state.pages[0];
        const promise = Promise.resolve<QueryResult>({ data: page ?? [], error: null });

        const builder = {
          eq: (column: string, value: unknown) => {
            record.filters[column] = value;
            return builder;
          },
          is: (column: string, value: unknown) => {
            record.filters[column] = value;
            return builder;
          },
          lt: (column: string, value: unknown) => {
            record.filters[`lt:${column}`] = value;
            return builder;
          },
          gt: (column: string, value: unknown) => {
            record.filters[`gt:${column}`] = value;
            return builder;
          },
          order: (_column: string, options: { ascending: boolean }) => {
            record.ascending = options.ascending;
            return builder;
          },
          limit: (count: number) => {
            record.limit = count;
            return builder;
          },
          returns: () => builder,
          then: (
            onFulfilled: (value: QueryResult) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => promise.then(onFulfilled, onRejected),
        };
        return builder;
      },
    }),
  },
}));

const CHANNEL_ID = 'channel-1';

function row(id: string, createdAt: string): MessageRow {
  return {
    id,
    channel_id: CHANNEL_ID,
    sender_id: 'someone',
    ciphertext: 'x',
    created_at: createdAt,
    deleted_at: null,
  };
}

/** A page-sized run of messages, one minute apart from the given hour. */
function fullPage(prefix: string, hour: number): MessageRow[] {
  return Array.from({ length: MESSAGE_PAGE_SIZE }, (_unused, index) =>
    row(`${prefix}-${index}`, new Date(Date.UTC(2026, 8, 8, hour, index)).toISOString()),
  );
}

beforeEach(() => {
  state.queries = [];
  state.pages = [];
});

describe('fetchMessages', () => {
  it('queries newest first and hands back oldest first', async () => {
    state.pages = [[row('b', '2026-09-08T11:00:00.000Z'), row('a', '2026-09-08T10:00:00.000Z')]];

    const result = await fetchMessages(CHANNEL_ID);

    expect(state.queries[0]?.ascending).toBe(false);
    expect(result.map((message) => message.id)).toEqual(['a', 'b']);
  });

  it('pages back with a strict before-cursor', async () => {
    state.pages = [[]];

    await fetchMessages(CHANNEL_ID, { before: '2026-09-08T10:00:00.000Z' });

    expect(state.queries[0]?.filters['lt:created_at']).toBe('2026-09-08T10:00:00.000Z');
    expect(state.queries[0]?.ascending).toBe(false);
  });

  it('catches up ascending, so the page is the oldest messages above the cursor', async () => {
    state.pages = [[row('a', '2026-09-08T10:00:00.000Z'), row('b', '2026-09-08T11:00:00.000Z')]];

    const result = await fetchMessages(CHANNEL_ID, { after: '2026-09-08T09:00:00.000Z' });

    expect(state.queries[0]?.ascending).toBe(true);
    expect(state.queries[0]?.filters['gt:created_at']).toBe('2026-09-08T09:00:00.000Z');
    // Already in the right order: not reversed a second time.
    expect(result.map((message) => message.id)).toEqual(['a', 'b']);
  });

  it('never returns deleted messages', async () => {
    state.pages = [[]];
    await fetchMessages(CHANNEL_ID);
    expect(state.queries[0]?.filters['deleted_at']).toBeNull();
  });
});

describe('fetchMessagesSince', () => {
  it('stops after one page when that page is short', async () => {
    state.pages = [[row('a', '2026-09-08T10:00:00.000Z')]];

    const result = await fetchMessagesSince(CHANNEL_ID, '2026-09-08T09:00:00.000Z');

    expect(result).toHaveLength(1);
    expect(state.queries).toHaveLength(1);
  });

  it('keeps paging forward while pages come back full', async () => {
    const first = fullPage('first', 10);
    const second = [row('last', '2026-09-08T12:00:00.000Z')];
    state.pages = [first, second];

    const result = await fetchMessagesSince(CHANNEL_ID, '2026-09-08T09:00:00.000Z');

    // A long disconnect can leave more than a page behind. Grabbing only the
    // newest page would leave a hole that scrolling back never fills.
    expect(result).toHaveLength(MESSAGE_PAGE_SIZE + 1);
    expect(state.queries).toHaveLength(2);
    // The second page continues from the end of the first, not from the start.
    expect(state.queries[1]?.filters['gt:created_at']).toBe(first[first.length - 1]?.created_at);
  });

  it('gives up rather than paging forever', async () => {
    state.pages = [fullPage('endless', 10)];

    const result = await fetchMessagesSince(CHANNEL_ID, '2026-09-08T09:00:00.000Z');

    expect(state.queries.length).toBeLessThanOrEqual(10);
    expect(result.length).toBe(state.queries.length * MESSAGE_PAGE_SIZE);
  });

  it('returns nothing when there is nothing to catch up on', async () => {
    state.pages = [[]];

    expect(await fetchMessagesSince(CHANNEL_ID, '2026-09-08T09:00:00.000Z')).toEqual([]);
  });
});
