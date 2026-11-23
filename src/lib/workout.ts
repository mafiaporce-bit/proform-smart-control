// Workout tracker. Speed is ENTERED BY THE USER (or assumed from the program
// plan they are following) to match the treadmill console. Nothing here is
// read from or sent to the treadmill. Distance and calories are worked out
// from that speed and the elapsed time.

import { useSyncExternalStore } from 'react';
import { addWorkout, type SpeedSample, type Workout } from '../db/db';
import { kcalPerMinute } from './calories';
import { currentBpm } from './hr';
import { planTotalSec, type Plan, type PlanSegment } from './programs';
import { getSettings } from './settings';
import { speak } from './voice';
import { COACH_LINES, coachSay, pushLine } from './coachvoice';
import { clearCoachLine, showCoachLine } from './coachline';

export interface WorkoutState {
  status: 'idle' | 'running' | 'paused';
  startedAt: number | null;
  /** Active time in ms (pauses excluded). */
  activeMs: number;
  /** Time of the last tick while running, so time is counted correctly after the screen sleeps. */
  lastTick: number | null;
  speedKmh: number;
  inclinePct: number;
  distanceKm: number;
  kcal: number;
  maxKmh: number;
  samples: SpeedSample[];
  targetMin: number | null;
  plan: Plan | null;
  segIndex: number;
  planDone: boolean;
  /** Heart rate: time-weighted sum, covered time and peak, from a strap if one is connected. */
  hrSum: number;
  hrMs: number;
  hrMax: number;
  /** Voice cues already spoken in this workout. */
  said: string[];
  /** Virtual Running environment name, when the workout was started from it. */
  virtual: string | null;
  /** Active time during which speed came from the treadmill itself (verified telemetry). */
  measuredMs: number;
}

export const SPEED_MIN = 0.5;
/** Upper bound of the logging input only. It is not a treadmill limit and controls nothing. */
export const SPEED_MAX = 20;

const KEY = 'psc.workout';
const fresh = (): WorkoutState => ({
  status: 'idle',
  startedAt: null,
  activeMs: 0,
  lastTick: null,
  speedKmh: 5,
  inclinePct: 0,
  distanceKm: 0,
  kcal: 0,
  maxKmh: 0,
  samples: [],
  targetMin: null,
  plan: null,
  segIndex: 0,
  planDone: false,
  hrSum: 0,
  hrMs: 0,
  hrMax: 0,
  said: [],
  virtual: null,
  measuredMs: 0,
});

function load(): WorkoutState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return fresh();
}

let state = load();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let lastSave = 0;
let wakeLock: { release(): Promise<void> } | null = null;

const emit = () => listeners.forEach((fn) => fn());
const persist = (force = false) => {
  const now = Date.now();
  if (!force && now - lastSave < 3000) return;
  lastSave = now;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
};
const set = (patch: Partial<WorkoutState>, save = false) => {
  state = { ...state, ...patch };
  persist(save);
  emit();
};

export const useWorkout = () =>
  useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => state,
  );
export const getWorkout = () => state;

async function holdScreen(on: boolean) {
  try {
    if (on && getSettings().keepAwake && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await (navigator as any).wakeLock.request('screen');
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}

// ---- plan helpers -------------------------------------------------------
export const segEndSec = (plan: Plan, index: number) => plan.segments.slice(0, index + 1).reduce((a, s) => a + s.sec, 0);

const spokenSpeed = (kmh: number) => `${kmh.toFixed(1)} kilometres per hour`;
const spokenTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s) parts.push(`${s} seconds`);
  return parts.join(' ');
};
const segmentCue = (seg: PlanSegment) => `${seg.label}. Set the console to ${spokenSpeed(seg.kmh)} for ${spokenTime(seg.sec)}.`;

const CHEERS = ['Nice and steady.', 'You are doing well.', 'Good rhythm. Keep breathing.', 'Strong work.', 'Stay tall, relax your shoulders.'];

// ---- the clock ----------------------------------------------------------
/** Moves the workout forward by dt ms, splitting at plan segment boundaries so each part uses its own speed. */
/** Belt speed reported by the treadmill (verified telemetry), or null when there is none. Set by src/ble/telemetry.ts. */
let measured: number | null = null;

/**
 * Feeds the real belt speed into the workout. While it is not null, distance and calories use it
 * instead of the typed-in speed, and a stopped belt (0) adds no distance. Null = back to the typed-in speed.
 */
export function setMeasuredSpeed(kmh: number | null) {
  const v = kmh === null || !Number.isFinite(kmh) ? null : Math.max(0, Math.min(30, kmh));
  if (v === measured) return;
  if (state.status === 'running') tick(); // count the time so far at the old speed
  measured = v;
  if (v === null) return;
  const shown = Math.round(v * 10) / 10, active = state.status !== 'idle';
  const patch: Partial<WorkoutState> = {};
  // Keep the typed-in speed in step, so if the link drops the workout carries on at the last real speed.
  if (shown >= SPEED_MIN && shown <= SPEED_MAX && shown !== state.speedKmh) patch.speedKmh = shown;
  if (active) {
    const last = state.samples[state.samples.length - 1];
    if (!last || last.kmh !== shown) patch.samples = [...state.samples, { t: Math.round(state.activeMs / 1000), kmh: shown }].slice(-2000);
    if (shown > state.maxKmh) patch.maxKmh = shown;
  }
  if (Object.keys(patch).length) set(patch, true);
}
export const getMeasuredSpeed = () => measured;

function advance(dt: number) {
  const s = state;
  const weight = getSettings().weightKg;
  let { activeMs, distanceKm, kcal, speedKmh, segIndex, planDone, maxKmh, samples, measuredMs } = s;
  let cue: string | null = null;
  let cueKey: string | null = null; // when set and Charlie is on, play this trainer line instead of speaking `cue`
  let left = dt;

  while (left > 0) {
    let step = left;
    let boundary = false;
    if (s.plan && !planDone) {
      const remain = segEndSec(s.plan, segIndex) * 1000 - activeMs;
      if (remain <= left) {
        step = Math.max(0, remain);
        boundary = true;
      }
    }
    const v = measured ?? speedKmh;
    distanceKm += (v * step) / 3_600_000;
    if (v > 0) kcal += (kcalPerMinute(v, weight, s.inclinePct) * step) / 60_000;
    if (measured !== null) measuredMs += step;
    activeMs += step;
    left -= step;
    if (boundary && s.plan) {
      if (segIndex + 1 < s.plan.segments.length) {
        segIndex++;
        const seg = s.plan.segments[segIndex];
        if (measured === null) {
          speedKmh = seg.kmh;
          maxKmh = Math.max(maxKmh, speedKmh);
          samples = [...samples, { t: Math.round(activeMs / 1000), kmh: speedKmh }].slice(-2000);
        }
        cue = segmentCue(seg);
        const prevKmh = s.plan.segments[segIndex - 1]?.kmh ?? seg.kmh;
        cueKey = seg.kmh > prevKmh + 0.05 ? 'speedup' : seg.kmh < prevKmh - 0.05 ? 'easedown' : 'steady';
      } else {
        planDone = true;
        cue = 'Plan complete. Slow down, then stop the belt on the console when you are ready.';
      }
    }
  }

  // Heart rate, only while a fresh reading exists.
  const bpm = currentBpm();
  const hr = bpm ? { hrSum: s.hrSum + bpm * dt, hrMs: s.hrMs + dt, hrMax: Math.max(s.hrMax, bpm) } : {};

  // One spoken line at most per tick. A speed change always wins.
  const said = [...s.said];
  const once = (key: string, line: string, ck?: string) => {
    if (cue || said.includes(key)) return;
    said.push(key);
    cue = line;
    if (ck) cueKey = ck;
  };
  const sec = activeMs / 1000;
  const settings = getSettings();
  if (!cue) {
    const kmDone = Math.floor(distanceKm);
    if (kmDone > Math.floor(s.distanceKm) && settings.kmAnnounce) { cue = `${kmDone} kilometre${kmDone === 1 ? '' : 's'} done.`; cueKey = 'km'; }
  }
  if (s.plan && !planDone) {
    const seg = s.plan.segments[segIndex];
    const next = s.plan.segments[segIndex + 1];
    const remain = segEndSec(s.plan, segIndex) - sec;
    if (next && seg.sec >= 30 && remain <= 10 && remain > 3) {
      once(`warn-${segIndex}`, `In ten seconds, ${next.label.toLowerCase()} at ${spokenSpeed(next.kmh)}.`);
    }
  }
  if (s.targetMin) {
    const goal = s.targetMin * 60;
    if (sec >= goal / 2 && sec < goal / 2 + 30) once('half', 'Halfway there.', 'half');
    if (!s.plan && sec >= goal) once('goal', 'Goal time reached. Well done.');
  }
  if (settings.cheer) {
    const five = Math.floor(sec / 300);
    if (five >= 1 && sec - five * 300 < 20) once(`cheer-${five}`, `${five * 5} minutes done. ${CHEERS[five % CHEERS.length]}`, pushLine(five));
  }

  set({ activeMs, distanceKm, kcal, speedKmh, segIndex, planDone, maxKmh, samples, measuredMs, said, ...hr });
  if (cue) {
    const charlie = Boolean(cueKey) && getSettings().coachVoice === 'charlie';
    showCoachLine(charlie ? COACH_LINES[cueKey as string] ?? cue : cue);
    if (charlie) void coachSay(cueKey as string); else void speak(cue);
  }
}

function tick() {
  if (state.status !== 'running' || state.lastTick === null) return;
  const now = Date.now();
  const dt = now - state.lastTick;
  if (dt <= 0) return;
  state = { ...state, lastTick: now };
  advance(dt);
}

function runTimer(on: boolean) {
  if (on && !timer) timer = setInterval(tick, 250);
  if (!on && timer) { clearInterval(timer); timer = null; }
}

// ---- actions ------------------------------------------------------------
export function startWorkout(opts: { targetMin?: number | null; plan?: Plan | null; virtual?: string | null } = {}) {
  if (state.status !== 'idle') return;
  const now = Date.now();
  const plan = opts.plan ?? null;
  const speedKmh = plan ? plan.segments[0].kmh : state.speedKmh;
  state = { ...fresh(), speedKmh, inclinePct: state.inclinePct };
  set(
    {
      status: 'running',
      startedAt: now,
      lastTick: now,
      maxKmh: speedKmh,
      samples: [{ t: 0, kmh: speedKmh }],
      plan,
      targetMin: plan ? Math.round(planTotalSec(plan) / 60) : (opts.targetMin ?? null),
      virtual: opts.virtual ?? null,
    },
    true,
  );
  runTimer(true);
  void holdScreen(true);
  const startLine = plan
    ? `Starting ${plan.name}. Clip on your safety key. ${segmentCue(plan.segments[0])}`
    : opts.virtual
      ? `Starting ${opts.virtual}. Clip on your safety key and start the belt on the console.`
      : 'Workout started. Clip on your safety key.';
  if (getSettings().coachVoice === 'charlie') {
    showCoachLine(COACH_LINES.start);
    void speak('Clip on your safety key.', true); void coachSay('start');
  } else {
    showCoachLine(startLine);
    void speak(startLine);
  }
}

export function pauseWorkout() {
  if (state.status !== 'running') return;
  tick();
  set({ status: 'paused', lastTick: null }, true);
  runTimer(false);
  void speak('Timer paused.');
}

export function resumeWorkout() {
  if (state.status !== 'paused') return;
  set({ status: 'running', lastTick: Date.now() }, true);
  runTimer(true);
  void holdScreen(true);
  void speak('Timer resumed.');
}

export function setLoggedSpeed(kmh: number) {
  const v = Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, kmh)) * 10) / 10;
  if (v === state.speedKmh) return;
  if (state.status === 'running') tick();
  const active = state.status !== 'idle';
  set(
    {
      speedKmh: v,
      maxKmh: active ? Math.max(state.maxKmh, v) : state.maxKmh,
      samples: active ? [...state.samples, { t: Math.round(state.activeMs / 1000), kmh: v }].slice(-2000) : state.samples,
    },
    true,
  );
}

export function setLoggedIncline(pct: number) {
  if (state.status === 'running') tick();
  set({ inclinePct: Math.min(15, Math.max(0, Math.round(pct * 2) / 2)) }, true);
}

const reset = () => {
  const { speedKmh, inclinePct } = state;
  state = { ...fresh(), speedKmh, inclinePct };
  clearCoachLine();
  persist(true);
  emit();
};

/** Ends the workout and saves it. Returns the saved record, or null if it was too short to keep. */
export async function finishWorkout(): Promise<Workout | null> {
  if (state.status === 'idle' || state.startedAt === null) return null;
  if (state.status === 'running') tick();
  runTimer(false);
  void holdScreen(false);
  const durationSec = Math.round(state.activeMs / 1000);
  let saved: Workout | null = null;
  if (durationSec >= 10) {
    saved = {
      startedAt: state.startedAt,
      endedAt: Date.now(),
      durationSec,
      distanceKm: Math.round(state.distanceKm * 1000) / 1000,
      kcal: Math.round(state.kcal),
      avgKmh: Math.round((state.distanceKm / (durationSec / 3600)) * 10) / 10,
      maxKmh: state.maxKmh,
      inclinePct: state.inclinePct,
      source: state.measuredMs > state.activeMs / 2 ? 'treadmill' : 'manual',
      samples: state.samples,
      ...(state.plan ? { program: state.plan.name } : {}),
      ...(state.virtual ? { virtual: state.virtual } : {}),
      ...(state.hrMs >= 10_000 ? { avgHr: Math.round(state.hrSum / state.hrMs), maxHr: state.hrMax } : {}),
    };
    saved.id = await addWorkout(saved);
    if (getSettings().coachVoice === 'charlie') void coachSay('finish');
    void speak(`Workout saved. ${saved.distanceKm.toFixed(2)} kilometres in ${Math.round(durationSec / 60)} minutes. Remember to stop the belt on the console.`);
  }
  reset();
  return saved;
}

export function discardWorkout() {
  runTimer(false);
  void holdScreen(false);
  reset();
}

// A workout left running while the app was closed for a while is put on pause
// at the last moment it was seen, so the gap is not counted as exercise.
if (state.status === 'running' && state.lastTick !== null && Date.now() - state.lastTick > 5 * 60_000) {
  state = { ...state, status: 'paused', lastTick: null };
  persist(true);
}
// Resume a workout that was running when the app was reloaded.
if (state.status === 'running') {
  runTimer(true);
  void holdScreen(true);
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.status === 'running') {
      tick();
      wakeLock = null; // the browser drops the lock when the page is hidden
      void holdScreen(true);
    } else if (document.visibilityState === 'hidden') {
      persist(true);
    }
  });
}
