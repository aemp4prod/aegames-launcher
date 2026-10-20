export type GameId = 'laliferp' | 'hype';

export type GameSession = {
  id: string;
  gameId: GameId;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  lastHeartbeatAt: string;
};

export type StatisticsPeriod = '7d' | '30d' | '90d' | '1y' | 'all';

const STORAGE_PREFIX = 'ae-game-sessions';
const MAX_SESSIONS = 2500;

function storageKey(userId: string, gameId: GameId) {
  return `${STORAGE_PREFIX}:${userId}:${gameId}`;
}
function emitStatsChange(gameId: GameId) {
  window.dispatchEvent(new CustomEvent('ae-game-stats-change', { detail: { gameId } }));
}

function safeDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function readSessions(userId: string, gameId: GameId): GameSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId, gameId)) || '[]') as GameSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((session) => session?.gameId === gameId && session.id && session.startedAt)
      .map((session) => ({
        ...session,
        endedAt: session.endedAt || null,
        durationMs: Math.max(0, Number(session.durationMs) || 0),
        lastHeartbeatAt: session.lastHeartbeatAt || session.endedAt || session.startedAt,
      }))
      .sort((left, right) => safeDate(right.startedAt).getTime() - safeDate(left.startedAt).getTime());
  } catch {
    return [];
  }
}

function writeSessions(userId: string, gameId: GameId, sessions: GameSession[]) {
  localStorage.setItem(storageKey(userId, gameId), JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  emitStatsChange(gameId);
}

export function loadGameSessions(userId: string, gameId: GameId, now = new Date()): GameSession[] {
  const sessions = readSessions(userId, gameId);
  let changed = false;
  const recovered = sessions.map((session) => {
    if (session.endedAt) return session;
    const heartbeat = safeDate(session.lastHeartbeatAt);
    if (now.getTime() - heartbeat.getTime() < 90_000) return session;
    changed = true;
    return {
      ...session,
      endedAt: heartbeat.toISOString(),
      durationMs: Math.max(0, heartbeat.getTime() - safeDate(session.startedAt).getTime()),
    };
  });
  if (changed) writeSessions(userId, gameId, recovered);
  return recovered;
}

export function beginGameSession(userId: string, gameId: GameId, now = new Date()) {
  const sessions = loadGameSessions(userId, gameId, now);
  const active = sessions.find((session) => !session.endedAt);
  if (active) return active.id;
  const session: GameSession = {
    id: `${gameId}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    gameId,
    startedAt: now.toISOString(),
    endedAt: null,
    durationMs: 0,
    lastHeartbeatAt: now.toISOString(),
  };
  writeSessions(userId, gameId, [session, ...sessions]);
  return session.id;
}

export function heartbeatGameSession(userId: string, gameId: GameId, now = new Date()) {
  const sessions = readSessions(userId, gameId);
  let changed = false;
  const next = sessions.map((session) => {
    if (session.endedAt) return session;
    changed = true;
    return {
      ...session,
      lastHeartbeatAt: now.toISOString(),
      durationMs: Math.max(0, now.getTime() - safeDate(session.startedAt).getTime()),
    };
  });
  if (changed) writeSessions(userId, gameId, next);
}

export function finishGameSession(userId: string, gameId: GameId, now = new Date()) {
  const sessions = readSessions(userId, gameId);
  let changed = false;
  const next = sessions.map((session) => {
    if (session.endedAt) return session;
    changed = true;
    return {
      ...session,
      endedAt: now.toISOString(),
      lastHeartbeatAt: now.toISOString(),
      durationMs: Math.max(0, now.getTime() - safeDate(session.startedAt).getTime()),
    };
  });
  if (changed) writeSessions(userId, gameId, next);
}

export function getPeriodStart(period: StatisticsPeriod, now = new Date()) {
  if (period === 'all') return null;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return start;
}

export function effectiveSessionEnd(session: GameSession, now = new Date()) {
  return session.endedAt ? safeDate(session.endedAt) : now;
}

export function filterSessionsByPeriod(sessions: GameSession[], period: StatisticsPeriod, now = new Date()) {
  const start = getPeriodStart(period, now);
  if (!start) return sessions;
  return sessions.filter((session) => effectiveSessionEnd(session, now).getTime() >= start.getTime());
}

export type GameStatisticsSummary = {
  totalMs: number;
  sessionCount: number;
  averageMs: number;
  longestMs: number;
  activeDays: number;
  currentStreak: number;
  bestStreak: number;
  lastSession: GameSession | null;
  weekMs: number;
};

export function summarizeGameSessions(sessions: GameSession[], now = new Date()): GameStatisticsSummary {
  const lengths = sessions.map((session) => Math.max(0, effectiveSessionEnd(session, now).getTime() - safeDate(session.startedAt).getTime()));
  const activeDayKeys = [...new Set(sessions.map((session) => {
    const date = safeDate(session.startedAt);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }))].sort();
  let bestStreak = 0;
  let streak = 0;
  let previous: Date | null = null;
  activeDayKeys.forEach((key) => {
    const date = new Date(`${key}T12:00:00`);
    streak = previous && Math.round((date.getTime() - previous.getTime()) / 86_400_000) === 1 ? streak + 1 : 1;
    bestStreak = Math.max(bestStreak, streak);
    previous = date;
  });
  let currentStreak = 0;
  if (activeDayKeys.length) {
    const today = new Date(now); today.setHours(12, 0, 0, 0);
    const latestDay = new Date(`${activeDayKeys.at(-1)}T12:00:00`);
    if (Math.round((today.getTime() - latestDay.getTime()) / 86_400_000) <= 1) {
      currentStreak = 1;
      for (let index = activeDayKeys.length - 1; index > 0; index -= 1) {
        const current = new Date(`${activeDayKeys[index]}T12:00:00`);
        const before = new Date(`${activeDayKeys[index - 1]}T12:00:00`);
        if (Math.round((current.getTime() - before.getTime()) / 86_400_000) !== 1) break;
        currentStreak += 1;
      }
    }
  }
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekMs = sessions.reduce((sum, session) => {
    const end = effectiveSessionEnd(session, now);
    if (end <= weekStart) return sum;
    const start = safeDate(session.startedAt);
    return sum + Math.max(0, end.getTime() - Math.max(start.getTime(), weekStart.getTime()));
  }, 0);
  const totalMs = lengths.reduce((sum, value) => sum + value, 0);
  return {
    totalMs,
    sessionCount: sessions.length,
    averageMs: sessions.length ? totalMs / sessions.length : 0,
    longestMs: Math.max(0, ...lengths),
    activeDays: activeDayKeys.length,
    currentStreak,
    bestStreak,
    lastSession: sessions[0] ?? null,
    weekMs,
  };
}

export function loadGameStatisticsSummary(userId: string, gameId: GameId, now = new Date()) {
  return summarizeGameSessions(loadGameSessions(userId, gameId, now), now);
}

