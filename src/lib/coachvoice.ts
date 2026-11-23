// The trainer coach voice (ElevenLabs "Charlie"), used only when the user turns it on
// (settings.coachVoice === 'charlie'). It plays a fixed set of short motivational lines.
//
// How it stays cheap and offline: each line is fetched once from the Netlify function
// (netlify/functions/coach-voice.mjs, which keeps the API key server-side) and stored in the
// browser Cache, so after the first play it comes from the cache — free and offline.
// Anything that fails (no function, no key, offline, blocked) falls straight back to the
// app's normal voice (Kokoro / phone) via speak(), so the coach is never silent.

import { getSettings } from './settings';
import { speak } from './voice';

const FN = '/.netlify/functions/coach-voice';
const CACHE = 'psc-coach-voice';

/** Fallback words for each line, spoken by the normal voice when Charlie is unavailable. */
export const COACH_LINES: Record<string, string> = {
  start: "Alright, let's move. Here we go!",
  push1: "Come on, you've got this!",
  push2: "Don't you quit on me now!",
  push3: "You're stronger than this. Keep going!",
  push4: "Push, push, push! Stay with it!",
  speedup: "Pick it up! A little faster, come on!",
  easedown: "Ease it back a touch. Settle in.",
  steady: "That's your pace. Hold it right there!",
  km: "Another kilometre down. Keep pushing!",
  half: "Halfway there. Don't stop now!",
  last: "Last stretch. Empty the tank!",
  finish: "Yes! That's how you finish. Great work!",
};

let audio: HTMLAudioElement | null = null;
const player = () => (audio ??= typeof Audio === 'undefined' ? null : new Audio());

/** True once we have confirmed the function + key are live, so we don't keep probing. */
let known: boolean | null = null;
export async function coachVoiceAvailable(): Promise<boolean> {
  if (known !== null) return known;
  try {
    const r = await fetch(`${FN}?probe=1`, { cache: 'no-store' });
    known = r.ok && (await r.json()).ok === true;
  } catch { known = false; }
  return known;
}
export function resetCoachVoiceProbe() { known = null; }

async function clip(key: string): Promise<Blob | null> {
  const req = `${FN}?line=${encodeURIComponent(key)}`;
  try {
    if ('caches' in window) {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return await hit.blob();
      const r = await fetch(req);
      if (r.ok && (r.headers.get('content-type') || '').includes('audio')) {
        await c.put(req, r.clone());
        return await r.blob();
      }
      return null;
    }
    const r = await fetch(req);
    return r.ok && (r.headers.get('content-type') || '').includes('audio') ? await r.blob() : null;
  } catch {
    return null;
  }
}

/**
 * Says one coach line. `key` is one of COACH_LINES. With Charlie off, or on any failure, the
 * normal voice speaks the same words. Never throws.
 */
export async function coachSay(key: string): Promise<void> {
  const text = COACH_LINES[key] ?? key;
  const s = getSettings();
  if (!s.voiceOn) return;
  if (s.coachVoice !== 'charlie') return void speak(text);
  const el = player();
  if (!el || !(await coachVoiceAvailable())) return void speak(text);
  const blob = await clip(key);
  if (!blob) return void speak(text);
  try {
    el.src = URL.createObjectURL(blob);
    el.onended = el.onerror = () => { if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src); };
    await el.play();
  } catch {
    void speak(text); // autoplay blocked or decode error
  }
}

/** Rotates the four "push harder" lines so they don't repeat back to back. */
export const pushLine = (n: number) => `push${(((n % 4) + 4) % 4) + 1}`;
