import { supabase } from './client';

/**
 * "X is aan het typen…", over Realtime broadcast.
 *
 * Broadcast and not a table, and not Presence either. A table would mean a
 * write per keystroke and a row that is wrong the moment somebody closes their
 * laptop. Presence is for state that should persist as long as a connection
 * does, and "typing" is the opposite of that: it is true for two seconds and
 * then it is not.
 *
 * What leaves the browser is a user id and a username, both of which every
 * member of the channel already has. Never any part of what is being typed.
 */

/** Nobody is still typing after this long without a new signal. */
export const TYPING_TIMEOUT_MS = 3000;

/**
 * The gap between two broadcasts while somebody keeps typing.
 *
 * Comfortably under TYPING_TIMEOUT_MS so a steady typist never flickers out,
 * and far enough apart that a fast typist sends a handful of messages a
 * minute rather than one per character.
 */
export const TYPING_THROTTLE_MS = 1200;

interface TypingPayload {
  userId: string;
  username: string;
  /** false when someone stopped typing (sent the message, cleared the box). */
  typing: boolean;
}

export interface TypingChannel {
  /** Says you are typing. Safe to call on every keystroke; it throttles. */
  announce(): void;
  /** Says you stopped, immediately. */
  stop(): void;
  /** Leaves the room. */
  close(): void;
}

export function trackTyping(
  channelId: string,
  userId: string,
  username: string,
  onChange: (payload: TypingPayload) => void,
): TypingChannel {
  const channel = supabase.channel(`typing:${channelId}`, {
    // self: false — our own broadcast coming back would put us in our own
    // "is typing" list.
    config: { broadcast: { self: false } },
  });

  channel
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      const data = payload as Partial<TypingPayload>;
      if (typeof data.userId === 'string' && typeof data.username === 'string') {
        onChange({
          userId: data.userId,
          username: data.username,
          typing: data.typing !== false,
        });
      }
    })
    .subscribe();

  let lastSent = 0;

  const send = (typing: boolean): void => {
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId, username, typing } satisfies TypingPayload,
    });
  };

  return {
    announce(): void {
      const now = Date.now();
      if (now - lastSent < TYPING_THROTTLE_MS) {
        return;
      }
      lastSent = now;
      send(true);
    },
    stop(): void {
      // Reset the throttle: after stopping, the next keystroke should be
      // announced right away rather than waiting out the window.
      lastSent = 0;
      send(false);
    },
    close(): void {
      void supabase.removeChannel(channel);
    },
  };
}
