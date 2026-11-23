// The words the coach last said, so the workout dashboard can show them as a caption.
// Display only: this does not decide what or when the coach speaks. That stays in workout.ts.

import { useSyncExternalStore } from 'react';

export interface CoachLine { text: string; at: number }

let line: CoachLine | null = null;
const listeners = new Set<() => void>();

export function showCoachLine(text: string) {
  const t = text.trim();
  if (!t) return;
  line = { text: t, at: Date.now() };
  listeners.forEach((fn) => fn());
}

export function clearCoachLine() {
  line = null;
  listeners.forEach((fn) => fn());
}

export const useCoachLine = () =>
  useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => line,
  );
