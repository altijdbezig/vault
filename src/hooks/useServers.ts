import { useCallback, useEffect, useState } from 'react';
import {
  createChannel as createChannelRow,
  createServer as createServerRow,
  joinServer as joinServerRow,
  listMyServers,
  listServerChannels,
  listServerMembers,
} from '../lib/supabase/servers';
import type { ChannelSummary, ServerMember, ServerRole, ServerSummary } from '../types';

export interface UseServersResult {
  servers: ServerSummary[];
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
  /** Creates a server with a default channel and returns its id. */
  createServer(name: string): Promise<string>;
  joinServer(serverId: string): Promise<void>;
}

export function useServers(): UseServersResult {
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setServers(await listMyServers());
      setError(null);
    } catch (caught) {
      console.error('Kon servers niet laden:', caught);
      setError('Servers konden niet geladen worden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createServer = useCallback(
    async (name: string): Promise<string> => {
      const serverId = await createServerRow(name.trim());
      await reload();
      return serverId;
    },
    [reload],
  );

  const joinServer = useCallback(
    async (serverId: string): Promise<void> => {
      await joinServerRow(serverId.trim());
      await reload();
    },
    [reload],
  );

  return { servers, loading, error, reload, createServer, joinServer };
}

export interface UseServerChannelsResult {
  channels: ChannelSummary[];
  members: ServerMember[];
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
  /** Only owners and admins may create channels. */
  canCreateChannel: boolean;
  createChannel(name: string): Promise<string>;
}

/** Channels and members of the active server. */
export function useServerChannels(
  serverId: string | null,
  role: ServerRole | null,
): UseServerChannelsResult {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (!serverId) {
      setChannels([]);
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [serverChannels, serverMembers] = await Promise.all([
        listServerChannels(serverId),
        listServerMembers(serverId),
      ]);
      setChannels(serverChannels);
      setMembers(serverMembers);
      setError(null);
    } catch (caught) {
      console.error('Kon server niet laden:', caught);
      setError('Kanalen van deze server konden niet geladen worden.');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createChannel = useCallback(
    async (name: string): Promise<string> => {
      if (!serverId) {
        throw new Error('Geen server geselecteerd.');
      }
      const channelId = await createChannelRow(serverId, name.trim());
      await reload();
      return channelId;
    },
    [reload, serverId],
  );

  return {
    channels,
    members,
    loading,
    error,
    reload,
    canCreateChannel: role === 'owner' || role === 'admin',
    createChannel,
  };
}
