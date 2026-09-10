/**
 * Local preferences.
 *
 * Everything in here lives in localStorage and nowhere else. Not in Postgres:
 * these are per-device choices (which theme, how big the text, whether this
 * browser may show notifications), and a server round trip would make them
 * both slower and someone else's business.
 *
 * That does mean they do not follow you to another device, which is the right
 * trade for a theme and the wrong trade for nothing else here.
 */

export type ThemeChoice = 'system' | 'dark' | 'light';
export type Density = 'comfortable' | 'compact';

export interface VaultSettings {
  theme: ThemeChoice;
  density: Density;
  /** Multiplier on the type scale. Clamped to the range the UI offers. */
  fontScale: number;
  /**
   * Fetching link previews in the client.
   *
   * Off by default and it stays off unless someone deliberately turns it on.
   * A preview means the browser requests the target URL, which tells that
   * server the reader's IP address and that this exact link was opened in a
   * private conversation. That is a leak the sender never agreed to.
   */
  linkPreviews: boolean;
  /** Broadcasting "is typing" to the other members. */
  typingIndicator: boolean;
  /** Desktop notifications. Permission is asked when this is switched on. */
  notifications: boolean;
  /** A sound with a notification. Off by default; sound is intrusive. */
  notificationSound: boolean;
  /** Channel ids with notifications switched off. */
  mutedChannels: string[];
}

export const DEFAULT_SETTINGS: VaultSettings = {
  theme: 'system',
  density: 'comfortable',
  fontScale: 1,
  linkPreviews: false,
  typingIndicator: true,
  notifications: false,
  notificationSound: false,
  mutedChannels: [],
};

/**
 * The one key. index.html reads this same blob in an inline script to set the
 * theme before the first paint; change the shape here and change it there.
 */
const STORAGE_KEY = 'vault:settings';

export const MIN_FONT_SCALE = 0.85;
export const MAX_FONT_SCALE = 1.3;

function clampFontScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.fontScale;
  }
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Reads the stored settings, filling in anything missing or malformed.
 *
 * Every field is checked individually rather than trusting the blob as a
 * whole: this JSON survives across versions of the app, so a field that used
 * to be a string and is now a boolean must not turn into a broken setting the
 * user cannot fix from the UI.
 */
export function loadSettings(): VaultSettings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Blocked storage (private mode, hardened browser). Defaults are fine.
    return DEFAULT_SETTINGS;
  }

  if (!raw) {
    return DEFAULT_SETTINGS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return DEFAULT_SETTINGS;
  }

  const saved = parsed as Partial<Record<keyof VaultSettings, unknown>>;

  return {
    theme:
      saved.theme === 'dark' || saved.theme === 'light' || saved.theme === 'system'
        ? saved.theme
        : DEFAULT_SETTINGS.theme,
    density:
      saved.density === 'compact' || saved.density === 'comfortable'
        ? saved.density
        : DEFAULT_SETTINGS.density,
    fontScale: clampFontScale(saved.fontScale),
    linkPreviews:
      typeof saved.linkPreviews === 'boolean'
        ? saved.linkPreviews
        : DEFAULT_SETTINGS.linkPreviews,
    typingIndicator:
      typeof saved.typingIndicator === 'boolean'
        ? saved.typingIndicator
        : DEFAULT_SETTINGS.typingIndicator,
    notifications:
      typeof saved.notifications === 'boolean'
        ? saved.notifications
        : DEFAULT_SETTINGS.notifications,
    notificationSound:
      typeof saved.notificationSound === 'boolean'
        ? saved.notificationSound
        : DEFAULT_SETTINGS.notificationSound,
    mutedChannels: isStringArray(saved.mutedChannels)
      ? saved.mutedChannels
      : DEFAULT_SETTINGS.mutedChannels,
  };
}

export function saveSettings(settings: VaultSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Nothing to do about it, and nothing worth breaking the UI over.
  }
}

/** Resolves 'system' against the OS preference. */
export function resolveTheme(choice: ThemeChoice): 'dark' | 'light' {
  if (choice !== 'system') {
    return choice;
  }
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Writes the appearance settings onto <html>.
 *
 * The same three attributes the inline script in index.html sets, so the
 * app taking over does not move anything.
 */
export function applyAppearance(settings: VaultSettings): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const resolved = resolveTheme(settings.theme);

  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-density', settings.density);
  root.style.setProperty('--vault-font-scale', String(settings.fontScale));

  // Read the colour back out of the token rather than repeating the hex here.
  // The attribute above has already been set, so the computed value is the one
  // belonging to the theme now showing. Falls back silently in jsdom, where
  // getComputedStyle returns an empty string for a custom property.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const color = getComputedStyle(root).getPropertyValue('--vault-meta-theme').trim();
    if (color) {
      meta.setAttribute('content', color);
    }
  }
}
