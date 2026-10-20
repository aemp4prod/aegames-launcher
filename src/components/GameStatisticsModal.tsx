import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, CalendarDays, Clock3, Flame, History, MousePointer2, Trophy, X } from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import { effectiveSessionEnd, filterSessionsByPeriod, getPeriodStart, loadGameSessions, type GameId, type GameSession, type StatisticsPeriod } from '../lib/gameStats';

type Bucket = { key: string; label: string; value: number; detail: string };
type ChartMode = 'time' | 'sessions';

const periodOptions: { value: StatisticsPeriod; label: string }[] = [
  { value: '7d', label: '7 jours' }, { value: '30d', label: '30 jours' }, { value: '90d', label: '90 jours' }, { value: '1y', label: '1 an' }, { value: 'all', label: 'Depuis toujours' },
];

const dayFormatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });
const dateFormatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function duration(milliseconds: number, compact = false) {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min`;
  return compact ? `${hours} h ${minutes ? String(minutes).padStart(2, '0') : ''}`.trim() : `${hours} h ${minutes} min`;
}
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weekKey(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return dayKey(copy);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function splitSession(session: GameSession, now: Date, visitor: (start: Date, end: Date) => void) {
  let cursor = new Date(session.startedAt);
  const end = effectiveSessionEnd(session, now);
  while (cursor < end) {
    const boundary = new Date(cursor);
    boundary.setHours(24, 0, 0, 0);
    const segmentEnd = boundary < end ? boundary : end;
    visitor(cursor, segmentEnd);
    cursor = segmentEnd;
  }
}

function calculate(sessions: GameSession[], period: StatisticsPeriod, now: Date) {
  const filtered = filterSessionsByPeriod(sessions, period, now);
  const periodStart = getPeriodStart(period, now);
  const daily = new Map<string, number>();
  const weekly = new Map<string, number>();
  const monthly = new Map<string, number>();
  const weekdays = Array.from({ length: 7 }, () => 0);
  const hours = Array.from({ length: 24 }, () => 0);

  filtered.forEach((session) => splitSession(session, now, (rawStart, rawEnd) => {
    const start = periodStart && rawStart < periodStart ? periodStart : rawStart;
    if (start >= rawEnd) return;
    const milliseconds = rawEnd.getTime() - start.getTime();
    daily.set(dayKey(start), (daily.get(dayKey(start)) || 0) + milliseconds);
    weekly.set(weekKey(start), (weekly.get(weekKey(start)) || 0) + milliseconds);
    monthly.set(monthKey(start), (monthly.get(monthKey(start)) || 0) + milliseconds);
    weekdays[(start.getDay() + 6) % 7] += milliseconds;
    let cursor = new Date(start);
    while (cursor < rawEnd) {
      const hourEnd = new Date(cursor);
      hourEnd.setMinutes(60, 0, 0);
      const segmentEnd = hourEnd < rawEnd ? hourEnd : rawEnd;
      hours[cursor.getHours()] += segmentEnd.getTime() - cursor.getTime();
      cursor = segmentEnd;
    }
  }));

  const total = filtered.reduce((sum, session) => {
    const start = new Date(session.startedAt);
    const end = effectiveSessionEnd(session, now);
    return sum + Math.max(0, end.getTime() - (periodStart && start < periodStart ? periodStart.getTime() : start.getTime()));
  }, 0);
  const activeDays = [...daily.keys()].sort();
  const allActiveDays = [...new Set(sessions.map((session) => dayKey(new Date(session.startedAt))))].sort();
  let bestStreak = 0;
  let streak = 0;
  let previous: Date | null = null;
  allActiveDays.forEach((key) => {
    const date = new Date(`${key}T12:00:00`);
    streak = previous && Math.round((date.getTime() - previous.getTime()) / 86_400_000) === 1 ? streak + 1 : 1;
    bestStreak = Math.max(bestStreak, streak);
    previous = date;
  });
  let currentStreak = 0;
  if (allActiveDays.length) {
    const last = new Date(`${allActiveDays.at(-1)}T12:00:00`);
    const today = new Date(now); today.setHours(12, 0, 0, 0);
    const distance = Math.round((today.getTime() - last.getTime()) / 86_400_000);
    if (distance <= 1) {
      currentStreak = 1;
      for (let index = allActiveDays.length - 1; index > 0; index -= 1) {
        const current = new Date(`${allActiveDays[index]}T12:00:00`);
        const before = new Date(`${allActiveDays[index - 1]}T12:00:00`);
        if (Math.round((current.getTime() - before.getTime()) / 86_400_000) !== 1) break;
        currentStreak += 1;
      }
    }
  }
  const sessionLength = (session: GameSession) => effectiveSessionEnd(session, now).getTime() - new Date(session.startedAt).getTime();
  const longest = filtered.reduce<GameSession | null>((best, session) => !best || sessionLength(session) > sessionLength(best) ? session : best, null);
  const longestDuration = longest ? sessionLength(longest) : 0;
  const top = (values: Map<string, number>) => [...values.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0] as [string, number];
  return { filtered, total, average: filtered.length ? total / filtered.length : 0, activeDays, daily, weekdays, hours, longest, longestDuration, currentStreak, bestStreak, bestDay: top(daily), bestWeek: top(weekly), bestMonth: top(monthly) };
}

function activityBuckets(stats: ReturnType<typeof calculate>, period: StatisticsPeriod, mode: ChartMode, now: Date): Bucket[] {
  const countByDay = new Map<string, number>();
  stats.filtered.forEach((session) => countByDay.set(dayKey(new Date(session.startedAt)), (countByDay.get(dayKey(new Date(session.startedAt))) || 0) + 1));
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : period === '1y' ? 365 : Math.max(14, Math.ceil((now.getTime() - Math.min(...stats.filtered.map((session) => new Date(session.startedAt).getTime()), now.getTime())) / 86_400_000) + 1);
  const group = days > 45 ? (days > 180 ? 30 : 7) : 1;
  const buckets: Bucket[] = [];
  for (let offset = days - 1; offset >= 0; offset -= group) {
    let value = 0;
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - offset);
    for (let day = 0; day < group && offset - day >= 0; day += 1) {
      const date = new Date(start); date.setDate(date.getDate() + day);
      value += mode === 'time' ? stats.daily.get(dayKey(date)) || 0 : countByDay.get(dayKey(date)) || 0;
    }
    buckets.push({ key: dayKey(start), label: dayFormatter.format(start), value, detail: mode === 'time' ? duration(value) : `${value} session${value > 1 ? 's' : ''}` });
  }
  return buckets;
}

function BarChart({ data, formatter = duration }: { data: Bucket[]; formatter?: (value: number) => string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(...data.map((item) => item.value), 1);
  return <div className="stats-bar-chart">
    <div className="stats-chart-bars">{data.map((item, index) => <button type="button" key={item.key} className={hovered === index ? 'hovered' : ''} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} aria-label={`${item.label} : ${item.detail}`}><i style={{ height: `${Math.max(item.value ? 6 : 2, item.value / max * 100)}%` }} />{hovered === index && <span className="chart-tooltip"><b>{item.label}</b><small>{formatter(item.value)}</small></span>}</button>)}</div>
    <div className="stats-chart-axis"><span>{data[0]?.label}</span><span>{data[Math.floor(data.length / 2)]?.label}</span><span>{data.at(-1)?.label}</span></div>
  </div>;
}

function recordLabel(key: string, kind: 'day' | 'week' | 'month') {
  if (!key) return 'Aucune donnée';
  if (kind === 'month') return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(`${key}-15T12:00:00`));
  const date = new Date(`${key}T12:00:00`);
  return kind === 'week' ? `Semaine du ${dateFormatter.format(date)}` : dateFormatter.format(date);
}

export function GameStatisticsModal({ userId, gameId, gameName, onClose }: { userId: string; gameId: GameId; gameName: string; onClose: () => void }) {
  const [period, setPeriod] = useState<StatisticsPeriod>('30d');
  const [chartMode, setChartMode] = useState<ChartMode>('time');
  const [clock, setClock] = useState(() => new Date());
  const [sessions, setSessions] = useState(() => loadGameSessions(userId, gameId));
  useEffect(() => {
    const refresh = () => { setClock(new Date()); setSessions(loadGameSessions(userId, gameId)); };
    const eventRefresh = (event: Event) => { if ((event as CustomEvent).detail?.gameId === gameId) refresh(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('ae-game-stats-change', eventRefresh);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => { window.clearInterval(timer); window.removeEventListener('ae-game-stats-change', eventRefresh); window.removeEventListener('keydown', escape); };
  }, [gameId, onClose, userId]);
  const stats = useMemo(() => calculate(sessions, period, clock), [clock, period, sessions]);
  const activity = useMemo(() => activityBuckets(stats, period, chartMode, clock), [chartMode, clock, period, stats]);
  const first = sessions.at(-1);
  const latest = sessions[0];
  const weekdayLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const weeklyData = stats.weekdays.map((value, index) => ({ key: String(index), label: weekdayLabels[index], value, detail: duration(value) }));
  const maxHour = Math.max(...stats.hours, 1);

  return createPortal(<div className={`game-modal-backdrop stats-modal-backdrop ${gameId === 'hype' ? 'hype-modal-backdrop' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`game-modal statistics-modal stats-theme-${gameId} ${gameId === 'hype' ? 'hype-game-modal' : ''}`} role="dialog" aria-modal="true" aria-label={`Statistiques de ${gameName}`}>
      <header><div>{gameId === 'hype' ? <img src="/assets/hype-logo-white.svg" alt="Hype" /> : <span>{gameName.toUpperCase()}</span>}<h2>Statistiques</h2></div><div className="stats-header-actions"><CustomSelect value={period} options={periodOptions} onChange={setPeriod} ariaLabel="Période des statistiques" /><button aria-label="Fermer" onClick={onClose}><X size={18} /></button></div></header>
      <div className="statistics-layout">
        <section className="stats-overview" aria-label="Vue d’ensemble">
          <article><span><Clock3 size={17} /></span><div><small>Temps total</small><strong>{duration(stats.total, true)}</strong></div></article>
          <article><span><Activity size={17} /></span><div><small>Sessions</small><strong>{stats.filtered.length}</strong></div></article>
          <article><span><MousePointer2 size={17} /></span><div><small>Durée moyenne</small><strong>{duration(stats.average, true)}</strong></div></article>
          <article><span><Trophy size={17} /></span><div><small>Plus longue</small><strong>{duration(stats.longestDuration, true)}</strong></div></article>
          <article><span><CalendarDays size={17} /></span><div><small>Jours actifs</small><strong>{stats.activeDays.length}</strong></div></article>
          <article><span><Flame size={17} /></span><div><small>Série actuelle / record</small><strong>{stats.currentStreak} / {stats.bestStreak} j</strong></div></article>
        </section>
        <section className="stats-panel activity-chart-panel"><div className="stats-panel-title"><div><small>ACTIVITÉ</small><h3>Évolution</h3></div><div className="chart-mode"><button className={chartMode === 'time' ? 'active' : ''} onClick={() => setChartMode('time')}>Temps</button><button className={chartMode === 'sessions' ? 'active' : ''} onClick={() => setChartMode('sessions')}>Sessions</button></div></div><BarChart data={activity} formatter={(value) => chartMode === 'time' ? duration(value) : `${value} session${value > 1 ? 's' : ''}`} /></section>
        <section className="stats-panel weekly-panel"><div className="stats-panel-title"><div><small>RYTHME</small><h3>Répartition hebdomadaire</h3></div></div><BarChart data={weeklyData} /></section>
        <section className="stats-panel hourly-panel"><div className="stats-panel-title"><div><small>HABITUDES</small><h3>Répartition horaire</h3></div></div><div className="hour-heatmap">{stats.hours.map((value, hour) => <span key={hour} title={`${hour} h – ${hour + 1} h : ${duration(value)}`} style={{ '--heat': String(value / maxHour) } as React.CSSProperties}><i />{hour % 3 === 0 && <small>{hour}h</small>}</span>)}</div></section>
        <section className="stats-panel records-panel"><div className="stats-panel-title"><div><small>RECORDS</small><h3>Meilleures performances</h3></div></div><div className="records-list"><p><span>Session</span><b>{duration(stats.longestDuration)}</b></p><p><span>Journée</span><b>{recordLabel(stats.bestDay[0], 'day')} · {duration(stats.bestDay[1], true)}</b></p><p><span>Semaine</span><b>{recordLabel(stats.bestWeek[0], 'week')} · {duration(stats.bestWeek[1], true)}</b></p><p><span>Mois</span><b>{recordLabel(stats.bestMonth[0], 'month')} · {duration(stats.bestMonth[1], true)}</b></p><p><span>Série</span><b>{stats.bestStreak} jour{stats.bestStreak > 1 ? 's' : ''}</b></p></div></section>
        <section className="stats-panel history-panel"><div className="stats-panel-title"><div><small>HISTORIQUE</small><h3>Sessions passées</h3></div><span>{first ? `Première · ${dateFormatter.format(new Date(first.startedAt))}` : 'Aucune session'}{latest ? ` · Dernière · ${dateFormatter.format(new Date(latest.startedAt))}` : ''}</span></div><div className="session-history">{stats.filtered.length ? stats.filtered.map((session) => { const start = new Date(session.startedAt); const end = effectiveSessionEnd(session, clock); return <article key={session.id}><span className={session.endedAt ? '' : 'live'}><History size={14} /></span><div><b>{dateFormatter.format(start)}</b><small>{timeFormatter.format(start)} — {session.endedAt ? timeFormatter.format(end) : 'En cours'}</small></div><strong>{duration(end.getTime() - start.getTime(), true)}</strong></article>; }) : <p className="stats-empty">Les prochaines sessions apparaîtront ici automatiquement.</p>}</div></section>
      </div>
    </section>
  </div>, document.body);
}

