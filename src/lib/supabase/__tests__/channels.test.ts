import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGroup, EmptyGroupError, leaveGroup } from '../channels';

interface QueryResult {
  data: unknown;
  error: unknown;
}

interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns?: string): QueryBuilder;
  eq(column: string, value: string): QueryBuilder;
  is(column: string, value: unknown): QueryBuilder;
  order(column: string, options?: unknown): QueryBuilder;
  limit(count: number): QueryBuilder;
  returns(): QueryBuilder;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
}

/** A PostgREST builder stub: awaitable, and chainable like the real one. */
function makeQuery(result: QueryResult): QueryBuilder {
  const promise = Promise.resolve(result);
  const builder: QueryBuilder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    returns: () => builder,
    single: () => promise,
    maybeSingle: () => promise,
    then: (onFulfilled, onRejected) => promise.then(onFulfilled, onRejected),
  };
  return builder;
}

const state = vi.hoisted(() => ({
  /** Results per table, consumed in order; the last one repeats. */
  insertResults: new Map<string, QueryResultLike[]>(),
  inserts: [] as { table: string; payload: unknown }[],
  deletes: [] as { table: string; filters: [string, string][] }[],
  nextInsertResult(table: string): QueryResultLike {
    const queued = state.insertResults.get(table) ?? [];
    return (queued.length > 1 ? queued.shift() : queued[0]) ?? { data: null, error: null };
  },
}));

interface QueryResultLike {
  data: unknown;
  error: unknown;
}

vi.mock('../client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'me' } } },
        error: null,
      }),
    },
    from: (table: string) => ({
      insert: (payload: unknown) => {
        state.inserts.push({ table, payload });
        return makeQuery(state.nextInsertResult(table));
      },
      delete: () => {
        const record: { table: string; filters: [string, string][] } = { table, filters: [] };
        state.deletes.push(record);
        const chain = {
          eq(column: string, value: string) {
            record.filters.push([column, value]);
            return chain;
          },
          then: (onFulfilled: (value: QueryResult) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(onFulfilled),
        };
        return chain;
      },
      select: () => makeQuery({ data: [], error: null }),
    }),
  },
}));

const CHANNEL_ID = 'group-1';

beforeEach(() => {
  state.insertResults.clear();
  state.inserts = [];
  state.deletes = [];

  state.insertResults.set('channels', [{ data: { id: CHANNEL_ID }, error: null }]);
  state.insertResults.set('channel_members', [{ data: null, error: null }]);
});

describe('createGroup', () => {
  it('creates a server-less channel of type group and adds you before the others', async () => {
    const id = await createGroup('Vakantie', ['user-b', 'user-c']);

    expect(id).toBe(CHANNEL_ID);
    expect(state.inserts.map((insert) => insert.table)).toEqual([
      'channels',
      'channel_members',
      'channel_members',
    ]);
    expect(state.inserts[0]?.payload).toMatchObject({
      type: 'group',
      server_id: null,
      name: 'Vakantie',
    });

    // Yourself first: the insert policy only allows adding other people once
    // you are a member yourself. Same order as createDm.
    expect(state.inserts[1]?.payload).toMatchObject({ channel_id: CHANNEL_ID, user_id: 'me' });
    expect(state.inserts[2]?.payload).toEqual([
      { channel_id: CHANNEL_ID, user_id: 'user-b' },
      { channel_id: CHANNEL_ID, user_id: 'user-c' },
    ]);
    expect(state.deletes).toEqual([]);
  });

  it('drops duplicates and your own id from the member list', async () => {
    await createGroup('Vakantie', ['user-b', 'user-b', 'me', 'user-c']);

    expect(state.inserts[2]?.payload).toEqual([
      { channel_id: CHANNEL_ID, user_id: 'user-b' },
      { channel_id: CHANNEL_ID, user_id: 'user-c' },
    ]);
  });

  it('refuses a group that would only contain you', async () => {
    await expect(createGroup('Alleen ik', ['me'])).rejects.toThrow(EmptyGroupError);
    expect(state.inserts).toEqual([]);
  });

  it('rolls the channel back when adding the others fails', async () => {
    // Adding yourself succeeds, adding the rest is refused: that is the shape
    // of an RLS problem on the second insert.
    state.insertResults.set('channel_members', [
      { data: null, error: null },
      { data: null, error: { code: '42501', message: 'denied' } },
    ]);

    await expect(createGroup('Vakantie', ['user-b'])).rejects.toMatchObject({ code: '42501' });

    expect(state.deletes).toEqual([{ table: 'channels', filters: [['id', CHANNEL_ID]] }]);
  });
});

describe('leaveGroup', () => {
  it('deletes only your own membership row', async () => {
    await leaveGroup(CHANNEL_ID);

    expect(state.deletes).toEqual([
      {
        table: 'channel_members',
        filters: [
          ['channel_id', CHANNEL_ID],
          ['user_id', 'me'],
        ],
      },
    ]);
  });
});
