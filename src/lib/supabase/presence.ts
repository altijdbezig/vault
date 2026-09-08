import { supabase } from './client';

/**
 * Who is online, over Realtime Presence.
 *
 * Nothing about presence is written to Postgres. It is worthless a second
 * after it is produced and it would only add a table, a write on every focus
 * change and a row that is wrong the moment someone closes their laptop.
 * Realtime keeps it in memory and drops it when the socket goes.
 *
 * The presence key is the user id rather than a per-connection id, so two tabs
 * of the same account collapse into one entry: they show up as two metas under
 * one key, and closing one tab leaves the other one online.
 */
const PRESENCE_ROOM = 'presence:vault';

export function trackPresence(
  userId: string,
  onChange: (onlineUserIds: string[]) => void,
): () => void {
  const channel = supabase.channel(PRESENCE_ROOM, {
    config: { presence: { key: userId } },
  });

  channel
    .on('presence', { event: 'sync' }, () => {
      onChange(Object.keys(channel.presenceState()));
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Only the timestamp: presence is broadcast to everyone in the room,
        // so it must never carry anything that is not already public.
        void channel.track({ online_at: new Date().toISOString() });
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
