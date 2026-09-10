/**
 * The keyboard shortcuts, in one list.
 *
 * Shared between the handler that implements them and the overview in
 * settings, so the overview cannot drift away from what the app actually does.
 * A shortcuts screen that lies is worse than no shortcuts screen.
 */

export interface Shortcut {
  /** As displayed. Uses the symbols people see on their own keyboard. */
  keys: string;
  description: string;
}

/** True on a Mac, where the modifier is Cmd rather than Ctrl. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  // userAgentData is not everywhere yet and navigator.platform is deprecated
  // but still the only thing that works in every browser we care about. A
  // wrong guess only changes a label, so this does not need to be clever.
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

const MOD = isMac() ? '⌘' : 'Ctrl';

export const SHORTCUTS: Shortcut[] = [
  { keys: `${MOD}+K`, description: 'Commandpalet openen' },
  { keys: `${MOD}+Shift+A`, description: 'Alles als gelezen markeren' },
  { keys: 'Shift+Esc', description: 'Dit kanaal als gelezen markeren' },
  { keys: 'Alt+↑ / Alt+↓', description: 'Vorig of volgend kanaal' },
  { keys: 'Esc', description: 'Sluiten wat er open staat' },
  { keys: 'Enter', description: 'Bericht versturen' },
  { keys: 'Shift+Enter', description: 'Nieuwe regel in een bericht' },
];
