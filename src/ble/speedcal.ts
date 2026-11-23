// The verified speed position for this treadmill, saved on the phone after the speed check
// (Bluetooth Lab) matched the console at three speeds. Without it, no treadmill speed is shown anywhere.
import { useSyncExternalStore } from 'react';
import type { SpeedSlot, SpeedUnit } from './ifit';

export interface SpeedCal extends SpeedSlot {
  /** Length of the reply's value bytes when it was verified. A reply of another length is not decoded. */
  len: number;
  savedAt: number;
  /** The three (or more) readings it was verified with. */
  samples: Array<{ shown: number; unit: SpeedUnit; raw: number }>;
  /** Other positions that matched as well (for example a target speed next to the measured one). */
  alsoMatched: number[];
}

const KEY = 'psc.speedCal';
function load(): SpeedCal | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (c && Number.isInteger(c.offset) && (c.scale === 100 || c.scale === 10) && (c.rawUnit === 'kmh' || c.rawUnit === 'mph') && Number.isInteger(c.len)) return c;
  } catch { /* storage blocked or corrupt */ }
  return null;
}
let current = load();
const listeners = new Set<() => void>();
export const getCal = () => current;
export function saveCal(c: SpeedCal | null) {
  current = c;
  try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useCal = () => useSyncExternalStore(subscribe, getCal);
