// Training programs: recommended speed plans. The app tells you when to change
// speed; you change it on the console. Nothing here is sent to the treadmill.

export type SegKind = 'warm' | 'steady' | 'fast' | 'easy' | 'cool';
export type Level = 'easy' | 'standard' | 'hard';

export interface PlanSegment {
  label: string;
  kind: SegKind;
  sec: number;
  kmh: number;
}
export interface Plan {
  id: string;
  name: string;
  segments: PlanSegment[];
}
export interface ProgramDef {
  id: string;
  name: string;
  blurb: string;
  /** [kind, minutes, km/h] at Standard level. */
  base: Array<[SegKind, number, number]>;
}

const LABEL: Record<SegKind, string> = { warm: 'Warm-up', steady: 'Steady', fast: 'Fast', easy: 'Recover', cool: 'Cool-down' };
const repeat = (n: number, block: Array<[SegKind, number, number]>) => Array.from({ length: n }, () => block).flat();

export const PROGRAMS: ProgramDef[] = [
  {
    id: 'beginner',
    name: 'Beginner Walk',
    blurb: 'Easy steady walking to build the habit.',
    base: [['warm', 3, 3.5], ['steady', 14, 4.5], ['cool', 3, 3.5]],
  },
  {
    id: 'fat',
    name: 'Fat Burning',
    blurb: 'Longer brisk walk at a pace you can hold a chat at.',
    base: [['warm', 5, 4.0], ['steady', 25, 5.5], ['cool', 5, 4.0]],
  },
  {
    id: 'interval',
    name: 'Interval Training',
    blurb: 'One fast minute, two easy minutes, six times.',
    base: [['warm', 4, 4.5], ...repeat(6, [['fast', 1, 8.0], ['easy', 2, 5.0]]), ['cool', 3, 4.0]],
  },
  {
    id: 'cardio',
    name: 'Cardio Endurance',
    blurb: 'A steady jog to build staying power.',
    base: [['warm', 5, 5.0], ['steady', 30, 7.5], ['cool', 5, 4.5]],
  },
  {
    id: 'weight',
    name: 'Weight Loss',
    blurb: 'Brisk walk with short jogs mixed in.',
    base: [['warm', 4, 4.5], ...repeat(5, [['steady', 3, 6.0], ['fast', 2, 7.5]]), ['cool', 5, 4.0]],
  },
];

export const LEVELS: Array<{ id: Level; label: string; factor: number }> = [
  { id: 'easy', label: 'Easy', factor: 0.85 },
  { id: 'standard', label: 'Standard', factor: 1 },
  { id: 'hard', label: 'Hard', factor: 1.15 },
];

export const programById = (id: string) => PROGRAMS.find((p) => p.id === id);
export const planTotalSec = (plan: Plan) => plan.segments.reduce((a, s) => a + s.sec, 0);
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Builds a plan at a level. Speeds are capped at `maxKmh` (the user's own
 * comfort cap). With `targetMin`, the main part is stretched or shortened so
 * the whole plan lasts about that long; warm-up and cool-down keep their length.
 */
export function buildPlan(def: ProgramDef, level: Level, maxKmh: number, targetMin?: number): Plan {
  const factor = LEVELS.find((l) => l.id === level)?.factor ?? 1;
  const edge = def.base.filter(([k]) => k === 'warm' || k === 'cool').reduce((a, [, m]) => a + m, 0);
  const main = def.base.reduce((a, [, m]) => a + m, 0) - edge;
  const stretch = targetMin && main > 0 ? Math.max(5, targetMin - edge) / main : 1;
  return {
    id: def.id,
    name: `${def.name}${level === 'standard' ? '' : level === 'easy' ? ' (Easy)' : ' (Hard)'}`,
    segments: def.base.map(([kind, min, kmh]) => ({
      label: LABEL[kind],
      kind,
      sec: kind === 'warm' || kind === 'cool' ? min * 60 : Math.max(30, Math.round((min * 60 * stretch) / 30) * 30),
      kmh: Math.min(maxKmh, Math.max(2, round1(kmh * factor))),
    })),
  };
}

// ---- Custom workout -----------------------------------------------------
export interface CustomBlock {
  min: number;
  kmh: number;
}
const CUSTOM_KEY = 'psc.custom';
export const defaultCustom = (): CustomBlock[] => [
  { min: 5, kmh: 4.0 },
  { min: 10, kmh: 6.0 },
  { min: 5, kmh: 4.0 },
];

export function loadCustom(): CustomBlock[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (Array.isArray(v) && v.length) return v;
  } catch { /* ignore */ }
  return defaultCustom();
}
export function saveCustom(blocks: CustomBlock[]) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(blocks)); } catch { /* ignore */ }
}

export function buildCustomPlan(blocks: CustomBlock[], maxKmh: number): Plan {
  const top = Math.max(...blocks.map((b) => b.kmh));
  return {
    id: 'custom',
    name: 'Custom Workout',
    segments: blocks.map((b, i) => ({
      label: `Block ${i + 1}`,
      kind: (i === 0 && blocks.length > 2 ? 'warm' : i === blocks.length - 1 && blocks.length > 2 ? 'cool' : b.kmh >= top && blocks.length > 2 ? 'fast' : 'steady') as SegKind,
      sec: Math.max(1, b.min) * 60,
      kmh: Math.min(maxKmh, Math.max(1, round1(b.kmh))),
    })),
  };
}
