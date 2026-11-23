import type { Workout } from '../db/db';
import { dayKey } from './format';

export const DAY = 86_400_000;

/** Monday 00:00 of the week containing `ms`. */
export function weekStart(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export interface Totals {
  count: number;
  sec: number;
  km: number;
  kcal: number;
}
export const totals = (list: Workout[]): Totals =>
  list.reduce((a, w) => ({ count: a.count + 1, sec: a.sec + w.durationSec, km: a.km + w.distanceKm, kcal: a.kcal + w.kcal }), { count: 0, sec: 0, km: 0, kcal: 0 });

export const between = (list: Workout[], from: number, to: number) => list.filter((w) => w.startedAt >= from && w.startedAt < to);

/** Current streak counts back from today, or from yesterday if today has no workout yet. */
export function streaks(list: Workout[], now = Date.now()) {
  const days = new Set(list.map((w) => dayKey(w.startedAt)));
  const start = new Date(now);
  start.setHours(12, 0, 0, 0);
  const step = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };

  let cursor = days.has(dayKey(start.getTime())) ? start : step(start, -1);
  let current = 0;
  while (days.has(dayKey(cursor.getTime()))) { current++; cursor = step(cursor, -1); }

  let best = 0;
  for (const key of days) {
    const [y, m, d] = key.split('-').map(Number);
    const day = new Date(y, m - 1, d, 12);
    if (days.has(dayKey(step(day, -1).getTime()))) continue; // not the first day of a run
    let run = 0;
    let c = day;
    while (days.has(dayKey(c.getTime()))) { run++; c = step(c, 1); }
    best = Math.max(best, run);
  }
  return { current, best };
}
