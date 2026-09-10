import { useEffect } from 'react';

export interface ShortcutHandlers {
  onPalette: () => void;
  onMarkAllRead: () => void;
  onMarkChannelRead: () => void;
  onPreviousChannel: () => void;
  onNextChannel: () => void;
}

/**
 * True when the keystroke belongs to whatever the user is typing in.
 *
 * Without this check, Alt+Down inside the message box would switch channels
 * and take the half-typed message with it. contentEditable is included for
 * completeness even though nothing uses it yet.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * The app-wide keyboard shortcuts.
 *
 * One listener on the window rather than handlers spread over components, so
 * the whole set is visible in one place and cannot end up half-registered
 * depending on what is mounted. The list in lib/shortcuts.ts is what settings
 * displays; these are the same bindings, and the pairing is the point.
 *
 * Two rules run through all of them:
 *
 * - Anything that would interfere with typing is skipped while a field has
 *   focus, except the palette itself, which is supposed to be reachable from
 *   anywhere.
 * - preventDefault only when we actually handle it. Ctrl+K is a browser
 *   shortcut in some setups and Alt+Arrow is history navigation, so quietly
 *   swallowing them when we did nothing would break the browser.
 */
export function useShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // A modifier combination that is not ours should reach the browser.
      const mod = event.metaKey || event.ctrlKey;
      const typing = isTyping(event.target);

      // Ctrl/Cmd+K: the palette. Works while typing on purpose, because it is
      // the way out of anywhere.
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        handlers.onPalette();
        return;
      }

      // Ctrl/Cmd+Shift+A: everything read.
      if (mod && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        handlers.onMarkAllRead();
        return;
      }

      // Shift+Esc: this channel read. Escape on its own belongs to whatever
      // is open, so the shift is what keeps them apart.
      if (event.shiftKey && !mod && event.key === 'Escape') {
        event.preventDefault();
        handlers.onMarkChannelRead();
        return;
      }

      // Alt+Up / Alt+Down: previous and next channel.
      if (event.altKey && !mod && !typing) {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          handlers.onPreviousChannel();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          handlers.onNextChannel();
          return;
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [handlers]);
}
