import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  applyAppearance,
  DEFAULT_SETTINGS,
  loadSettings,
  resolveTheme,
  saveSettings,
} from '../lib/settings';
import type { VaultSettings } from '../lib/settings';

export interface SettingsContextValue {
  settings: VaultSettings;
  /** Whichever of dark/light is actually showing right now. */
  resolvedTheme: 'dark' | 'light';
  update<K extends keyof VaultSettings>(key: K, value: VaultSettings[K]): void;
  /** Notifications off for one channel, or back on. */
  setChannelMuted(channelId: string, muted: boolean): void;
  isChannelMuted(channelId: string): boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Local preferences for the whole app.
 *
 * Sits outside AuthProvider on purpose: the sign-in and unlock screens need a
 * theme too, and someone who set light mode should not get a dark login
 * screen followed by a light app.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  // Read once, synchronously. The inline script in index.html already put the
  // same values on <html>, so this does not cause a second paint.
  const [settings, setSettings] = useState<VaultSettings>(loadSettings);

  useEffect(() => {
    applyAppearance(settings);
    saveSettings(settings);
  }, [settings]);

  // With theme 'system', the OS switching over has to move the app with it.
  // Without this listener the choice would only take effect on a reload.
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() =>
    resolveTheme('system'),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const query = window.matchMedia('(prefers-color-scheme: light)');
    const update = (event: MediaQueryListEvent): void => {
      setSystemTheme(event.matches ? 'light' : 'dark');
    };

    setSystemTheme(query.matches ? 'light' : 'dark');
    query.addEventListener('change', update);

    return () => {
      query.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    if (settings.theme === 'system') {
      applyAppearance(settings);
    }
  }, [settings, systemTheme]);

  const update = useCallback(
    <K extends keyof VaultSettings>(key: K, value: VaultSettings[K]): void => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const setChannelMuted = useCallback((channelId: string, muted: boolean): void => {
    setSettings((current) => {
      const without = current.mutedChannels.filter((id) => id !== channelId);
      return {
        ...current,
        mutedChannels: muted ? [...without, channelId] : without,
      };
    });
  }, []);

  const isChannelMuted = useCallback(
    (channelId: string): boolean => settings.mutedChannels.includes(channelId),
    [settings.mutedChannels],
  );

  const resolvedTheme =
    settings.theme === 'system' ? systemTheme : settings.theme;

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, resolvedTheme, update, setChannelMuted, isChannelMuted }),
    [settings, resolvedTheme, update, setChannelMuted, isChannelMuted],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/**
 * Settings, with a working fallback outside the provider.
 *
 * Returning defaults instead of throwing is deliberate here, unlike useAuth:
 * a component that reads a preference should not crash a test that mounted it
 * on its own. Nothing in here is a security decision — the worst case is a
 * dark theme and no notifications.
 */
export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (context) {
    return context;
  }

  return {
    settings: DEFAULT_SETTINGS,
    resolvedTheme: 'dark',
    update: () => undefined,
    setChannelMuted: () => undefined,
    isChannelMuted: () => false,
  };
}
