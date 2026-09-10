import { useCallback, useEffect, useState } from 'react';
import {
  addMemberToGroup,
  createDm,
  createGroup,
  leaveGroup as leaveGroupRow,
  listMyChannels,
} from '../lib/supabase/channels';
import { getProfileByUsername } from '../lib/supabase/profiles';
import type { ChannelSummary } from '../types';
import { useAuth } from './useAuth';
import { UserFacingError } from '../lib/userFacingError';

export class UserNotFoundError extends UserFacingError {
  constructor(username: string) {
    super(`Geen gebruiker gevonden met de naam "${username}".`);
  }
}

export interface UseChannelsResult {
  channels: ChannelSummary[];
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
  /** Opens (or creates) the DM with a username and returns the channel id. */
  startDm(username: string): Promise<string>;
  /** Creates a group with the given usernames and returns the channel id. */
  startGroup(name: string, usernames: string[]): Promise<string>;
  /** Adds someone to a group. They cannot read anything sent before now. */
  addToGroup(channelId: string, username: string): Promise<void>;
  leaveGroup(channelId: string): Promise<void>;
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

  /** Username to user id, with the two mistakes people actually make. */
  const resolveUser = useCallback(
    async (username: string): Promise<string> => {
      const trimmed = username.trim();
      const profile = await getProfileByUsername(trimmed);
      if (!profile) {
        throw new UserNotFoundError(trimmed);
      }
      if (profile.id === user?.id) {
        throw new Error('Je staat er zelf al in.');
      }
      return profile.id;
    },
    [user],
  );

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

  const startGroup = useCallback(
    async (name: string, usernames: string[]): Promise<string> => {
      // Resolved one by one so an unknown username names itself in the error
      // instead of failing the whole group anonymously.
      const userIds: string[] = [];
      for (const username of usernames) {
        userIds.push(await resolveUser(username));
      }

      const channelId = await createGroup(name, userIds);
      await reload();
      return channelId;
    },
    [reload, resolveUser],
  );

  const addToGroup = useCallback(
    async (channelId: string, username: string): Promise<void> => {
      await addMemberToGroup(channelId, await resolveUser(username));
      await reload();
    },
    [reload, resolveUser],
  );

  const leaveGroup = useCallback(
    async (channelId: string): Promise<void> => {
      await leaveGroupRow(channelId);
      await reload();
    },
    [reload],
  );

  return { channels, loading, error, reload, startDm, startGroup, addToGroup, leaveGroup };
}
