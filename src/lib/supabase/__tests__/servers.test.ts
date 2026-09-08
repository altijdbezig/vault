import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../servers';

interface QueryResult {
  data: unknown;
  error: unknown;
}

interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns?: string): QueryBuilder;
  eq(column: string, value: string): QueryBuilder;
  order(column: string, options?: unknown): QueryBuilder;
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
    order: () => builder,
    returns: () => builder,
    single: () => promise,
    maybeSingle: () => promise,
    then: (onFulfilled, onRejected) => promise.then(onFulfilled, onRejected),
  };
  return builder;
}

const state = vi.hoisted(() => ({
  /** Result each table's insert should produce, keyed by table name. */
  insertResults: new Map<string, { data: unknown; error: unknown }>(),
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  deletes: [] as { table: string; id: string }[],
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
      insert: (payload: Record<string, unknown>) => {
        state.inserts.push({ table, payload });
        return makeQuery(state.insertResults.get(table) ?? { data: null, error: null });
      },
      delete: () => ({
        eq: async (_column: string, value: string) => {
          state.deletes.push({ table, id: value });
          return { data: null, error: null };
        },
      }),
      select: () => makeQuery({ data: [], error: null }),
    }),
  },
}));

const SERVER_ID = 'server-1';
const CHANNEL_ID = 'channel-1';

beforeEach(() => {
  state.insertResults.clear();
  state.inserts = [];
  state.deletes = [];

  state.insertResults.set('servers', { data: { id: SERVER_ID }, error: null });
  state.insertResults.set('server_members', { data: null, error: null });
  state.insertResults.set('channels', { data: { id: CHANNEL_ID }, error: null });
  state.insertResults.set('channel_members', { data: null, error: null });
});

describe('createServer', () => {
  it('creates the server, the owner row, a default channel and joins it', async () => {
    const id = await createServer('Vault HQ');

    expect(id).toBe(SERVER_ID);
    expect(state.inserts.map((insert) => insert.table)).toEqual([
      'servers',
      'server_members',
      'channels',
      'channel_members',
    ]);
    expect(state.inserts[1]?.payload).toMatchObject({ user_id: 'me', role: 'owner' });
    expect(state.inserts[2]?.payload).toMatchObject({
      type: 'text',
      server_id: SERVER_ID,
      name: 'algemeen',
    });
    expect(state.deletes).toEqual([]);
  });

  it('rolls the server back when the owner membership fails', async () => {
    state.insertResults.set('server_members', {
      data: null,
      error: { code: '42501', message: 'new row violates row-level security policy' },
    });

    await expect(createServer('Vault HQ')).rejects.toMatchObject({ code: '42501' });

    // A server without an owner row is invisible to everyone, including its
    // creator, so it must not survive.
    expect(state.deletes).toEqual([{ table: 'servers', id: SERVER_ID }]);
    expect(state.inserts.map((insert) => insert.table)).toEqual(['servers', 'server_members']);
  });

  it('rolls back both the channel and the server when joining the channel fails', async () => {
    state.insertResults.set('channel_members', {
      data: null,
      error: { code: '42501', message: 'new row violates row-level security policy' },
    });

    await expect(createServer('Vault HQ')).rejects.toMatchObject({ code: '42501' });

    // Reverse order, and nothing half-built left behind.
    expect(state.deletes).toEqual([
      { table: 'channels', id: CHANNEL_ID },
      { table: 'servers', id: SERVER_ID },
    ]);
  });

  it('does not delete anything when the very first insert fails', async () => {
    state.insertResults.set('servers', {
      data: null,
      error: { code: '42501', message: 'denied' },
    });

    await expect(createServer('Vault HQ')).rejects.toMatchObject({ code: '42501' });
    expect(state.deletes).toEqual([]);
  });
});
