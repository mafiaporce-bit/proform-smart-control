// Rules-based coach. Works with no AI service and no internet. It only gives
// advice: it has no way to start the treadmill or change its speed.

import { useSyncExternalStore } from 'react';
import type { Workout } from '../db/db';
import { PROGRAMS, type Level } from './programs';
import { DAY, between, streaks, totals, weekStart } from './stats';

export type Goal = 'walk' | 'weight' | 'fitness' | 'run5k';
export type Experience = 'new' | 'some' | 'regular';

export interface CoachProfile {
  goal: Goal;
  experience: Experience;
  days: number;
  minutes: number;
}

export const GOALS: Array<{ id: Goal; label: string }> = [
  { id: 'walk', label: 'Move more' },
  { id: 'weight', label: 'Lose weight' },
  { id: 'fitness', label: 'Get fitter' },
  { id: 'run5k', label: 'Run 5 km' },
];
export const EXPERIENCE: Array<{ id: Experience; label: string; hint: string }> = [
  { id: 'new', label: 'New to it', hint: 'Little or no regular exercise lately' },
  { id: 'some', label: 'Some', hint: 'Active once or twice a week' },
  { id: 'regular', label: 'Regular', hint: 'Train three or more times a week' },
];

const KEY = 'psc.coach';
let profile: CoachProfile | null = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CoachProfile) : null;
  } catch { return null; }
})();
const listeners = new Set<() => void>();

export const getProfile = () => profile;
export function saveProfile(p: CoachProfile | null) {
  profile = p;
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}
export const useProfile = () =>
  useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getProfile,
  );

// ---- weekly plan --------------------------------------------------------
const MIX: Record<Goal, Record<Experience, Array<[string, Level]>>> = {
  walk: {
    new: [['beginner', 'easy'], ['beginner', 'standard'], ['fat', 'easy']],
    some: [['beginner', 'standard'], ['fat', 'standard'], ['beginner', 'hard']],
    regular: [['fat', 'standard'], ['fat', 'hard'], ['weight', 'standard']],
  },
  weight: {
    new: [['beginner', 'standard'], ['fat', 'easy'], ['weight', 'easy']],
    some: [['fat', 'standard'], ['weight', 'standard'], ['interval', 'easy']],
    regular: [['weight', 'hard'], ['interval', 'standard'], ['fat', 'hard']],
  },
  fitness: {
    new: [['beginner', 'standard'], ['fat', 'easy'], ['interval', 'easy']],
    some: [['cardio', 'easy'], ['interval', 'standard'], ['fat', 'standard']],
    regular: [['cardio', 'standard'], ['interval', 'hard'], ['cardio', 'hard']],
  },
  run5k: {
    new: [['beginner', 'standard'], ['interval', 'easy'], ['fat', 'easy']],
    some: [['interval', 'standard'], ['cardio', 'easy'], ['fat', 'standard']],
    regular: [['cardio', 'standard'], ['interval', 'hard'], ['cardio', 'hard']],
  },
};
const SPREAD: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 5], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface PlannedSession {
  day: string;
  programId: string;
  programName: string;
  level: Level;
  minutes: number;
}

export function weekPlan(p: CoachProfile): PlannedSession[] {
  const mix = MIX[p.goal][p.experience];
  return (SPREAD[p.days] ?? SPREAD[3]).map((dayIndex, i) => {
    const [programId, level] = mix[i % mix.length];
    return {
      day: DAYS[dayIndex],
      programId,
      programName: PROGRAMS.find((x) => x.id === programId)?.name ?? programId,
      level,
      minutes: p.minutes,
    };
  });
}

// ---- progress and goals -------------------------------------------------
export interface CoachView {
  goalMin: number;
  goalSessions: number;
  goalNote: string;
  doneMin: number;
  doneSessions: number;
  doneKm: number;
  lastWeekMin: number;
  streak: number;
  bestStreak: number;
  tips: string[];
  /** Offered when last week's goal was met. */
  levelUp: boolean;
}

const round5 = (v: number) => Math.round(v / 5) * 5;

export function coachView(p: CoachProfile, workouts: Workout[], now = Date.now()): CoachView {
  const ws = weekStart(now);
  const thisWeek = totals(between(workouts, ws, ws + 7 * DAY));
  const lastWeek = totals(between(workouts, ws - 7 * DAY, ws));
  const planned = p.days * p.minutes;
  const lastWeekMin = Math.round(lastWeek.sec / 60);
  const doneMin = Math.round(thisWeek.sec / 60);
  const { current, best } = streaks(workouts, now);

  // Achievable goal: the full plan, unless last week fell well short of it.
  // Then build up from what was actually done instead of repeating a miss.
  let goalMin = planned;
  let goalNote = `${p.days} sessions of ${p.minutes} minutes.`;
  if (lastWeekMin > 0 && lastWeekMin < planned * 0.6) {
    goalMin = Math.min(planned, Math.max(30, round5(lastWeekMin * 1.25)));
    goalNote = `Last week you did ${lastWeekMin} minutes, so this week aims a step above that rather than the full ${planned}.`;
  }
  const levelUp = lastWeekMin >= planned && p.minutes < 60;

  const tips: string[] = [];
  const dayOfWeek = Math.floor((now - ws) / DAY); // 0 = Monday
  const leftMin = Math.max(0, goalMin - doneMin);
  if (workouts.length === 0) {
    tips.push('Start with the first session in your plan. Finishing it matters more than the speed.');
  } else if (leftMin === 0) {
    tips.push(`Weekly goal reached with ${doneMin} minutes. Anything more this week is a bonus, so keep it easy.`);
  } else {
    const daysLeft = 7 - dayOfWeek;
    const sessionsLeft = Math.max(1, Math.min(daysLeft, p.days - thisWeek.count));
    const each = Math.max(5, round5(leftMin / sessionsLeft));
    if (each > p.minutes * 1.5) {
      tips.push(`${leftMin} minutes to go with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left. Do not cram: one normal ${p.minutes}-minute session is plenty, then start fresh on Monday.`);
    } else {
      tips.push(`${leftMin} minutes to go this week. That is ${sessionsLeft} more session${sessionsLeft === 1 ? '' : 's'} of about ${each} minutes.`);
    }
  }
  if (current >= 3) tips.push(`${current} days in a row. Plan a rest or easy day soon so your legs recover.`);
  else if (current === 0 && workouts.length > 0) {
    const last = workouts[0];
    const ago = Math.floor((now - last.startedAt) / DAY);
    if (ago >= 4) tips.push(`It has been ${ago} days since your last workout. Ease back in with a shorter, easier session.`);
  }
  if (lastWeekMin > 0 && doneMin > lastWeekMin) tips.push(`You have already passed last week's ${lastWeekMin} minutes.`);
  if (p.goal === 'weight') tips.push('For weight loss, longer brisk walks you can repeat most days beat one hard session.');
  if (p.goal === 'run5k') tips.push(p.experience === 'new' ? 'Jog the fast blocks only as fast as you could still say a full sentence.' : 'Keep the steady jogs truly steady. Save the push for interval day.');
  if (p.goal === 'fitness') tips.push('On interval days the easy blocks should feel easy. That is what makes the fast ones count.');
  if (p.goal === 'walk') tips.push('A small incline set by hand on the deck makes a walk harder without going faster.');

  return {
    goalMin,
    goalSessions: p.days,
    goalNote,
    doneMin,
    doneSessions: thisWeek.count,
    doneKm: thisWeek.km,
    lastWeekMin,
    streak: current,
    bestStreak: best,
    tips,
    levelUp,
  };
}

export function spokenSummary(p: CoachProfile, v: CoachView) {
  const left = Math.max(0, v.goalMin - v.doneMin);
  return [
    `This week you have done ${v.doneMin} minutes in ${v.doneSessions} session${v.doneSessions === 1 ? '' : 's'}.`,
    left ? `Your goal is ${v.goalMin} minutes, so ${left} to go.` : `You have reached your goal of ${v.goalMin} minutes.`,
    v.tips[v.tips.length > 1 ? 1 : 0] ?? '',
  ].join(' ');
}

// ---- optional AI chat (Netlify Function) --------------------------------
const FN = '/.netlify/functions/coach';

/** True only if the site was deployed with the function and an API key. */
export async function aiAvailable(): Promise<boolean> {
  try {
    const r = await fetch(FN, { method: 'GET' });
    if (!r.ok) return false;
    const j = await r.json();
    return j?.ok === true;
  } catch { return false; }
}

export async function askAi(question: string, p: CoachProfile | null, v: CoachView | null): Promise<string> {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question: question.slice(0, 600),
      profile: p,
      week: v ? { goalMin: v.goalMin, doneMin: v.doneMin, sessions: v.doneSessions, streak: v.streak } : null,
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.answer) throw new Error(j?.error ?? `The coach service answered ${r.status}`);
  return String(j.answer);
}
