/**
 * Normalising a server channel name.
 *
 * The UI already draws the "#" in front of every channel, so a user who types
 * it as well ends up with a channel called "#leden" rendered as "# #leden".
 * One shared function, used by both the create dialog (to show what will
 * happen while you type) and createChannel (to decide what is actually
 * stored), so the preview can never disagree with the result.
 *
 * Group and DM names do not go through this: those are free-form labels, not
 * channel handles.
 */

import type { ChannelType } from '../types';

/**
 * The glyph in front of a channel everywhere it is listed or titled.
 *
 * One function so the conversation list, the sidebar and the conversation
 * header cannot drift apart. A group gets its own mark rather than borrowing
 * the DM's "@": at a glance you need to know whether what you type goes to one
 * person or to five.
 */
export function channelPrefix(type: ChannelType): string {
  switch (type) {
    case 'dm':
      return '@';
    case 'group':
      return '👥';
    case 'text':
      return '#';
  }
}

/** The name normalised to nothing at all, so there is nothing to create. */
export class EmptyChannelNameError extends Error {
  constructor() {
    super('Geef het kanaal een naam.');
    this.name = 'EmptyChannelNameError';
  }
}

/**
 * Returns the name as it will be stored. May be an empty string, which callers
 * must reject; normalizeChannelName is deliberately total so the dialog can
 * call it on every keystroke without try/catch.
 */
export function normalizeChannelName(input: string): string {
  return input
    // A leading # is the user repeating what the interface already shows.
    // The character class also swallows any space they left in between.
    .replace(/^[#\s]+/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Same thing, but throws instead of returning an unusable empty name. */
export function requireChannelName(input: string): string {
  const normalized = normalizeChannelName(input);
  if (normalized === '') {
    throw new EmptyChannelNameError();
  }
  return normalized;
}
