import { useCallback, useEffect, useState } from 'react';
import { createDm, listMyChannels } from '../lib/supabase/channels';
import { getProfileByUsername } from '../lib/supabase/profiles';
import type { ChannelSummary } from '../types';
import { useAuth } from './useAuth';

export class UserNotFoundError extends Error {
  constructor(username: string) {
    super(`Geen gebruiker gevonden met de naam "${username}".`);
    this.name = 'UserNotFoundError';
  }
}

export interface UseChannelsResult {
  channels: ChannelSummary[];
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
  /** Opens (or creates) the DM with a username and returns the channel id. */
  startDm(username: string): Promise<string>;
}

export function useChannels(): UseChannelsResult {
  const { user } = useAuth();
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setChannels(await listMyChannels());
      setError(null);
    } catch (caught) {
      console.error('Kon kanalen niet laden:', caught);
      setError('Kanalen konden niet geladen worden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const startDm = useCallback(
    async (username: string): Promise<string> => {
      const trimmed = username.trim();
      const profile = await getProfileByUsername(trimmed);
      if (!profile) {
        throw new UserNotFoundError(trimmed);
      }
      if (profile.id === user?.id) {
        throw new Error('Je kunt geen gesprek met jezelf beginnen.');
      }

      const channelId = await createDm(profile.id);
      await reload();
      return channelId;
    },
    [reload, user],
  );

  return { channels, loading, error, reload, startDm };
}
