import { useSyncExternalStore } from 'react';

export interface Settings {
  weightKg: number;
  voiceOn: boolean;
  voiceEngine: 'kokoro' | 'phone';
  kokoroVoice: string;
  kmAnnounce: boolean;
  keepAwake: boolean;
  /** Highest speed any program will suggest. A comfort cap chosen by the user, not a treadmill limit. */
  planMaxKmh: number;
  cheer: boolean;
  /** After the speed check: do the start-up handshake and read speed on every connection. Off = plain read-only. */
  telemetryLink: boolean;
  /** Coach voice: 'standard' = Kokoro/phone; 'charlie' = the ElevenLabs trainer (needs the Netlify function + key). */
  coachVoice: 'standard' | 'charlie';
  /** Which coach picture the workout dashboard shows. Appearance only. */
  coachAvatar: 'male' | 'female';
}

const KEY = 'psc.settings';
const defaults: Settings = {
  weightKg: 75,
  voiceOn: true,
  voiceEngine: 'kokoro',
  kokoroVoice: 'af_heart',
  kmAnnounce: true,
  keepAwake: true,
  planMaxKmh: 10,
  cheer: true,
  telemetryLink: false,
  coachVoice: 'standard',
  coachAvatar: 'male',
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* storage blocked or corrupt */ }
  return defaults;
}

let current = load();
const listeners = new Set<() => void>();

export const getSettings = () => current;

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

export const useSettings = () => useSyncExternalStore(subscribe, getSettings);
