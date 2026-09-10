import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteMessage, sendMessage, updateMessage } from '../messages';
import type { MessageRow } from '../../../types';

/**
 * A harness for the write paths.
 *
 * Separate from messages.test.ts, which only mocks from().select() for the
 * read paths. Recording what actually went over the wire is the whole point
 * here: the guarantees being tested ("a deleted message keeps no ciphertext",
 * "user_id is not client-supplied") are about the payload, not the return
 * value.
 */
interface Call {
  table: string;
  operation: 'insert' | 'update';
  payload: Record<string, unknown>;
  filters: Record<string, unknown>;
  /** True when .select() was chained, so a row is read back. */
  selected: boolean;
}

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  row: null as unknown,
}));

vi.mock('../client', () => ({
  supabase: {
    from: (table: string) => {
      const make = (operation: 'insert' | 'update', payload: Record<string, unknown>) => {
        const call: Call = { table, operation, payload, filters: {}, selected: false };
        state.calls.push(call);

        const builder = {
          eq: (column: string, value: unknown) => {
            call.filters[column] = value;
            return builder;
          },
          select: () => {
            call.selected = true;
            return builder;
          },
          single: () => Promise.resolve({ data: state.row, error: null }),
          then: (onFulfilled: (value: unknown) => unknown) =>
            Promise.resolve({ data: state.row, error: null }).then(onFulfilled),
        };
        return builder;
      };

      return {
        insert: (payload: Record<string, unknown>) => make('insert', payload),
        update: (payload: Record<string, unknown>) => make('update', payload),
      };
    },
  },
}));

const ROW: MessageRow = {
  id: 'm-1',
  channel_id: 'channel-1',
  sender_id: 'user-a',
  ciphertext: 'CIPHER',
  created_at: '2026-09-10T10:00:00.000Z',
  edited_at: null,
  deleted_at: null,
  reply_to_id: null,
};

beforeEach(() => {
  state.calls = [];
  state.row = ROW;
});

describe('sendMessage', () => {
  it('stuurt alleen ciphertext, nooit een sender_id', async () => {
    await sendMessage('channel-1', 'CIPHER');

    const call = state.calls[0];
    expect(call?.payload).toEqual({
      channel_id: 'channel-1',
      ciphertext: 'CIPHER',
      reply_to_id: null,
    });
    // sender_id komt van de database (default auth.uid()). Zou de client hem
    // mogen meesturen, dan hangt "wie schreef dit" aan de client.
    expect(call?.payload).not.toHaveProperty('sender_id');
  });

  it('zet reply_to_id als het een antwoord is', async () => {
    await sendMessage('channel-1', 'CIPHER', 'm-origineel');

    expect(state.calls[0]?.payload['reply_to_id']).toBe('m-origineel');
  });
});

describe('updateMessage', () => {
  it('vervangt de ciphertext en stempelt edited_at', async () => {
    await updateMessage('m-1', 'NIEUWE-CIPHER');

    const call = state.calls[0];
    expect(call?.operation).toBe('update');
    expect(call?.filters['id']).toBe('m-1');
    expect(call?.payload['ciphertext']).toBe('NIEUWE-CIPHER');
    expect(typeof call?.payload['edited_at']).toBe('string');
  });

  it('raakt deleted_at niet aan', async () => {
    // Bewerken is geen verwijderen; een update die per ongeluk deleted_at
    // meeneemt zou een bericht laten verdwijnen bij het corrigeren van een typo.
    await updateMessage('m-1', 'NIEUWE-CIPHER');

    expect(state.calls[0]?.payload).not.toHaveProperty('deleted_at');
  });
});

/*
 * Dit is de test die het verschil tussen "verborgen" en "verwijderd" vastlegt.
 *
 * Zolang de ciphertext op de server staat, kan elk lid dat zijn sleutel nog
 * heeft hem blijven ontsleutelen, wat de UI ook toont. Een soft delete die
 * alleen deleted_at zet is dus geen verwijdering maar een gordijn.
 */
describe('deleteMessage', () => {
  it('maakt de ciphertext leeg en zet deleted_at', async () => {
    await deleteMessage('m-1');

    const call = state.calls[0];
    expect(call?.operation).toBe('update');
    expect(call?.filters['id']).toBe('m-1');
    expect(call?.payload['ciphertext']).toBe('');
    expect(typeof call?.payload['deleted_at']).toBe('string');
  });

  it('verwijdert de rij niet, zodat antwoorden en reacties blijven kloppen', async () => {
    await deleteMessage('m-1');

    expect(state.calls.every((call) => call.operation !== 'insert')).toBe(true);
    // Een echte delete zou hier als operation 'delete' langskomen; die bestaat
    // niet in deze module, en dat is de bedoeling.
    expect(state.calls[0]?.operation).toBe('update');
  });
});
