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

/**
 * What one server's lists look like once loaded, tagged with the server they
 * belong to.
 *
 * The tag is the whole point. Keeping channels and members in separate pieces
 * of state let the hook report the previous server's channels during the gap
 * between switching servers and the new lists arriving. Callers acted on that
 * stale list — the redirect to "the first channel of this server" navigated to
 * a channel of the server you had just left, which then unmounted and
 * remounted the conversation and refetched messages and members all over
 * again. One tagged object closes that gap: below, anything that does not
 * match the requested server simply reads as "still loading".
 */
type ServerState =
  | { serverId: string; status: 'ok'; channels: ChannelSummary[]; members: ServerMember[] }
  | { serverId: string; status: 'error'; message: string };

/** Stable identities, so callers can safely put these in dependency lists. */
const NO_CHANNELS: ChannelSummary[] = [];
const NO_MEMBERS: ServerMember[] = [];

const LOAD_FAILED = 'Kanalen van deze server konden niet geladen worden.';

async function loadServer(serverId: string): Promise<ServerState> {
  try {
    const [channels, members] = await Promise.all([
      listServerChannels(serverId),
      listServerMembers(serverId),
    ]);
    return { serverId, status: 'ok', channels, members };
  } catch (caught) {
    console.error('Kon server niet laden:', caught);
    return { serverId, status: 'error', message: LOAD_FAILED };
  }
}

/** Channels and members of the active server. */
export function useServerChannels(
  serverId: string | null,
  role: ServerRole | null,
): UseServerChannelsResult {
  const [state, setState] = useState<ServerState | null>(null);

  useEffect(() => {
    if (!serverId) {
      setState(null);
      return;
    }

    // A slow answer for the server you just left must not overwrite the one
    // you are looking at now.
    let cancelled = false;

    void (async () => {
      const result = await loadServer(serverId);
      if (!cancelled) {
        setState(result);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serverId]);

  const reload = useCallback(async (): Promise<void> => {
    setState(serverId ? await loadServer(serverId) : null);
  }, [serverId]);

  // Derived, not stored: there is no render in which these can disagree with
  // the server that was asked for.
  const current = state !== null && state.serverId === serverId ? state : null;
  const channels = current?.status === 'ok' ? current.channels : NO_CHANNELS;
  const members = current?.status === 'ok' ? current.members : NO_MEMBERS;
  const error = current?.status === 'error' ? current.message : null;
  const loading = serverId !== null && current === null;

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
