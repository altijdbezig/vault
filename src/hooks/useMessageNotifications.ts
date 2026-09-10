import { useEffect, useRef } from 'react';
import { notify } from '../lib/notifications';
import { useSettings } from './useSettings';
import { useUnread } from './useUnread';

export interface NotifiableChannel {
  id: string;
  /** "#algemeen" or a person's name. Never message content. */
  label: string;
  /** Where clicking the notification should go. */
  path: string;
}

interface Options {
  channels: readonly NotifiableChannel[];
  /** The channel on screen, which never notifies while the tab is focused. */
  activeChannelId: string | null;
  onNavigate: (path: string) => void;
}

/**
 * Turns incoming messages into desktop notifications.
 *
 * Rides on the subscription UnreadProvider already holds rather than opening
 * a second one. Everything this needs to decide is local: which channel,
 * whether the tab is focused, whether that channel is muted.
 *
 * What it deliberately cannot do is say anything about the message. The
 * plaintext exists only inside this tab and an OS notification ends up in a
 * system log, on a lock screen, and mirrored to a phone. See
 * lib/notifications.ts.
 */
export function useMessageNotifications({
  channels,
  activeChannelId,
  onNavigate,
}: Options): void {
  const { settings, isChannelMuted } = useSettings();
  const { subscribeToUnreadEvents } = useUnread();

  // The listener is registered once and has to see current values, so
  // everything it reads goes through a ref. Re-registering on every settings
  // change would be harmless but pointless churn.
  const stateRef = useRef({ channels, activeChannelId, settings, isChannelMuted, onNavigate });
  stateRef.current = { channels, activeChannelId, settings, isChannelMuted, onNavigate };

  useEffect(() => {
    const unsubscribe = subscribeToUnreadEvents((row) => {
      const state = stateRef.current;

      if (!state.settings.notifications) {
        return;
      }
      if (state.isChannelMuted(row.channel_id)) {
        return;
      }

      // The channel you are looking at, in a focused tab, does not need a
      // notification: the message is already on screen.
      const focused =
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        document.hasFocus();
      if (focused && row.channel_id === state.activeChannelId) {
        return;
      }

      const channel = state.channels.find((candidate) => candidate.id === row.channel_id);
      if (!channel) {
        // A channel we do not have loaded, so there is no name to show. A
        // notification saying "somewhere" is worse than none.
        return;
      }

      notify({
        where: channel.label,
        onClick: () => state.onNavigate(channel.path),
        sound: state.settings.notificationSound,
      });
    });

    return unsubscribe;
  }, [subscribeToUnreadEvents]);
}
