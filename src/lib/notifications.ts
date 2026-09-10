/**
 * Desktop notifications.
 *
 * The hard rule, and the reason this module is four functions instead of one
 * line: a notification never contains the message. The text is encrypted, it
 * exists in plaintext only inside the tab, and an OS notification is written
 * to a system log, mirrored to a phone, read out by a smart speaker and shown
 * on a lock screen. "Nieuw bericht in #algemeen" is all that leaves.
 *
 * That is not a limitation to work around later. A preview in a notification
 * would undo the whole design for the sake of a convenience.
 */

export type NotificationSupport = 'granted' | 'denied' | 'default' | 'unsupported';

export function notificationSupport(): NotificationSupport {
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Asks for permission.
 *
 * Only ever called from a click in settings. Asking at startup gets a denial
 * from anyone who has not decided yet, and a denial cannot be asked again.
 */
export async function requestNotificationPermission(): Promise<NotificationSupport> {
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return await Notification.requestPermission();
}

export interface NotifyOptions {
  /** "#algemeen" or "jayden" — a place, never a message. */
  where: string;
  /** Who sent it, when that is not already the place (a DM). */
  who?: string;
  /** Focuses the tab and opens the channel. */
  onClick: () => void;
  /** Whether to make a sound. Off unless the user turned it on. */
  sound: boolean;
}

/**
 * A short, distinctive click.
 *
 * Synthesised with the Web Audio API rather than shipped as a file: an
 * eighty-millisecond blip is four lines of oscillator, and a sound file would
 * be another asset to load, cache and version. No external request either,
 * which matters for the same reason the fonts are local.
 */
function playBlip(): void {
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    // A quick fade rather than a hard stop, which would click audibly.
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.08);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.09);

    // Contexts are a limited resource in some browsers, so let it go.
    oscillator.onended = () => {
      void context.close();
    };
  } catch {
    // Autoplay policy, no audio device, a locked context. A missing blip is
    // not worth an error.
  }
}

/**
 * Shows one notification.
 *
 * Returns false when nothing was shown, so the caller can tell "off" from
 * "shown" without duplicating the permission check.
 *
 * The tag is the channel: ten messages arriving in one channel replace each
 * other instead of stacking ten notifications, which is what makes this
 * bearable in a busy channel.
 */
export function notify(options: NotifyOptions): boolean {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return false;
  }

  try {
    const notification = new Notification('Vault', {
      // No message text. Not now, not behind a setting.
      body: options.who
        ? `Nieuw bericht van ${options.who} in ${options.where}`
        : `Nieuw bericht in ${options.where}`,
      tag: `vault:${options.where}`,
      // Replaces silently: the sound is ours to control, below.
      silent: true,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
      options.onClick();
    };

    if (options.sound) {
      playBlip();
    }

    return true;
  } catch {
    // Some browsers throw on construction inside a worker-less context or
    // when the site is not installed. Nothing to do about it.
    return false;
  }
}
