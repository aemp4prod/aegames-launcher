import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RealtimeChannel, User } from '@supabase/supabase-js';
import { loadProfile, type PresenceStatus, type ProfileData } from './auth';
import { loadBlockedProfiles, loadRelationships, type FriendProfile } from './friends';
import { supabase } from './supabase';

type LauncherPresence = {
  userId: string;
  status: Exclude<PresenceStatus, 'invisible'>;
  currentGame: string | null;
  onlineAt: string;
};

type SocialContextValue = {
  relationships: FriendProfile[];
  blockedProfiles: FriendProfile[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  applyPresence: <T extends FriendProfile>(profile: T) => T;
  setPresenceGame: (game: string | null) => void;
};

const SocialContext = createContext<SocialContextValue | null>(null);

export function SocialProvider({ user, children }: { user: User; children: ReactNode }) {
  const [storedRelationships, setStoredRelationships] = useState<FriendProfile[]>([]);
  const [storedBlockedProfiles, setStoredBlockedProfiles] = useState<FriendProfile[]>([]);
  const [presenceByUserId, setPresenceByUserId] = useState<Map<string, LauncherPresence>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const channelRef = useRef<RealtimeChannel | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshTimerRef = useRef(0);
  const ownPresenceRef = useRef<{ status: PresenceStatus; currentGame: string | null }>({ status: 'online', currentGame: null });

  const refresh = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const request = Promise.all([
      loadRelationships(),
      loadBlockedProfiles().catch(() => [] as FriendProfile[]),
    ]).then(([relationships, blockedProfiles]) => {
      setStoredRelationships(relationships);
      setStoredBlockedProfiles(blockedProfiles);
      setError('');
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Les données sociales n’ont pas pu être chargées.');
    }).finally(() => {
      setLoading(false);
      refreshPromiseRef.current = null;
    });
    refreshPromiseRef.current = request;
    return request;
  }, []);

  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => void refresh(), 180);
  }, [refresh]);

  const syncPresence = useCallback((channel: RealtimeChannel) => {
    const state = channel.presenceState<LauncherPresence>();
    const next = new Map<string, LauncherPresence>();
    Object.values(state).forEach((presences) => {
      presences.forEach((presence) => {
        const previous = next.get(presence.userId);
        if (!previous || presence.onlineAt > previous.onlineAt) next.set(presence.userId, presence);
      });
    });
    setPresenceByUserId(next);
  }, []);

  const publishPresence = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    const presence = ownPresenceRef.current;
    if (presence.status === 'invisible') {
      void channel.untrack();
      return;
    }
    void channel.track({
      userId: user.id,
      status: presence.status,
      currentGame: presence.currentGame,
      onlineAt: new Date().toISOString(),
    } satisfies LauncherPresence);
  }, [user.id]);

  const setPresenceGame = useCallback((currentGame: string | null) => {
    ownPresenceRef.current = { ...ownPresenceRef.current, currentGame };
    publishPresence();
  }, [publishPresence]);

  useEffect(() => {
    let disposed = false;
    const channel = supabase
      .channel('launcher-social-presence', { config: { presence: { key: user.id } } })
      .on('presence', { event: 'sync' }, () => syncPresence(channel))
      .on('presence', { event: 'join' }, () => syncPresence(channel))
      .on('presence', { event: 'leave' }, () => syncPresence(channel))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_blocks' }, scheduleRefresh)
      .on('broadcast', { event: 'profile-updated' }, ({ payload }) => {
        scheduleRefresh();
        window.dispatchEvent(new CustomEvent('ae-social-profile-changed', { detail: payload }));
      });
    channelRef.current = channel;
    void refresh();
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        publishPresence();
      }
    });

    void loadProfile(user).then((profile) => {
      if (disposed) return;
      ownPresenceRef.current = { ...ownPresenceRef.current, status: profile.status };
      publishPresence();
    }).catch(() => undefined);

    const handleFocus = () => void refresh();
    const handleProfileUpdate = (event: Event) => {
      const profile = (event as CustomEvent<ProfileData>).detail;
      if (profile?.status) ownPresenceRef.current = { ...ownPresenceRef.current, status: profile.status };
      publishPresence();
      scheduleRefresh();
      void channel.send({ type: 'broadcast', event: 'profile-updated', payload: { userId: user.id } });
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('ae-profile-updated', handleProfileUpdate);
    return () => {
      disposed = true;
      window.clearTimeout(refreshTimerRef.current);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('ae-profile-updated', handleProfileUpdate);
      channelRef.current = null;
      void channel.untrack().finally(() => supabase.removeChannel(channel));
    };
  }, [publishPresence, refresh, scheduleRefresh, syncPresence, user]);

  const applyPresence = useCallback(<T extends FriendProfile>(profile: T): T => {
    const presence = presenceByUserId.get(profile.userId);
    if (!presence) return { ...profile, presenceStatus: 'invisible', currentGame: undefined };
    return { ...profile, presenceStatus: presence.status, currentGame: presence.currentGame || undefined };
  }, [presenceByUserId]);

  const relationships = useMemo(() => storedRelationships.map(applyPresence), [applyPresence, storedRelationships]);
  const blockedProfiles = useMemo(() => storedBlockedProfiles.map(applyPresence), [applyPresence, storedBlockedProfiles]);
  const value = useMemo(() => ({ relationships, blockedProfiles, loading, error, refresh, applyPresence, setPresenceGame }), [applyPresence, blockedProfiles, error, loading, refresh, relationships, setPresenceGame]);

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial() {
  const context = useContext(SocialContext);
  if (!context) throw new Error('useSocial doit être utilisé dans SocialProvider.');
  return context;
}
