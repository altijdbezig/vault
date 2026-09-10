import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addReaction, fetchReactions, removeReaction } from '../reactions';

interface Call {
  table: string;
  operation: 'insert' | 'delete' | 'select';
  payload: Record<string, unknown> | null;
  filters: Record<string, unknown>;
  selected: boolean;
}

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  rows: [] as unknown[],
}));

vi.mock('../client', () => ({
  supabase: {
    from: (table: string) => {
      const make = (
        operation: 'insert' | 'delete' | 'select',
        payload: Record<string, unknown> | null,
      ) => {
        const call: Call = { table, operation, payload, filters: {}, selected: false };
        state.calls.push(call);

        const builder = {
          eq: (column: string, value: unknown) => {
            call.filters[column] = value;
            return builder;
          },
          in: (column: string, value: unknown) => {
            call.filters[`in:${column}`] = value;
            return builder;
          },
          order: () => builder,
          limit: () => builder,
          select: () => {
            call.selected = true;
            return builder;
          },
          returns: () => builder,
          then: (onFulfilled: (value: unknown) => unknown) =>
            Promise.resolve({ data: state.rows, error: null }).then(onFulfilled),
        };
        return builder;
      };

      return {
        insert: (payload: Record<string, unknown>) => make('insert', payload),
        delete: () => make('delete', null),
        select: () => make('select', null),
      };
    },
  },
}));

vi.mock('../session', () => ({
  currentUserId: () => Promise.resolve('user-a'),
}));

beforeEach(() => {
  state.calls = [];
  state.rows = [];
});

describe('fetchReactions', () => {
  it('doet geen request voor een lege lijst', async () => {
    const result = await fetchReactions([]);

    expect(result).toEqual([]);
    expect(state.calls).toHaveLength(0);
  });

  it('vraagt de reacties voor precies de meegegeven berichten', async () => {
    await fetchReactions(['m-1', 'm-2']);

    expect(state.calls[0]?.filters['in:message_id']).toEqual(['m-1', 'm-2']);
  });
});

describe('addReaction', () => {
  it('stuurt geen user_id mee', async () => {
    // De kolom heeft default auth.uid(). Zou de client hem mogen zetten, dan
    // kan iemand een reactie op naam van een ander plaatsen, policy
    // permitting.
    await addReaction('m-1', '👍');

    expect(state.calls[0]?.payload).toEqual({ message_id: 'm-1', emoji: '👍' });
    expect(state.calls[0]?.payload).not.toHaveProperty('user_id');
  });

  /*
   * Deze test bewaakt de kip-en-ei-val uit migratie 20260908140321.
   *
   * Een insert die de rij terugleest hangt óók aan de select-policy. Voor
   * reacties is dat nergens voor nodig: de client weet al wat hij plaatste.
   */
  it('leest de rij niet terug', async () => {
    await addReaction('m-1', '👍');

    expect(state.calls[0]?.selected).toBe(false);
  });
});

describe('removeReaction', () => {
  it('verwijdert precies één reactie van jezelf', async () => {
    await removeReaction('m-1', '👍');

    const call = state.calls[0];
    expect(call?.operation).toBe('delete');
    expect(call?.filters).toEqual({
      message_id: 'm-1',
      user_id: 'user-a',
      emoji: '👍',
    });
  });

  it('filtert altijd op de eigen user_id', async () => {
    // De policy staat alleen je eigen rij toe, maar zonder deze filter zou de
    // delete een 403 geven in plaats van niets te doen — en met een ruimere
    // policy zou hij de reactie van iemand anders weghalen.
    await removeReaction('m-1', '🎉');

    expect(state.calls[0]?.filters['user_id']).toBe('user-a');
  });
});
