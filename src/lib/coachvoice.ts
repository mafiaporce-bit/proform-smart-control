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
  safety: "Clip on your safety key first. Safety, then speed!",
  paused: "Timer paused. Catch your breath.",
  resumed: "And we're back. Let's go!",
  warn: "Change coming up in ten seconds. Get ready!",
  goal: "Goal time reached. You did it!",
  plandone: "Plan complete! Slow it down and stop the belt on the console.",
  saved: "Workout saved. Remember to stop the belt on the console.",
};

/** Words of the speed line, e.g. "Set it to 5.5 kilometres per hour!" (same as the server). */
export const speedText = (kmh: number) => `Set it to ${kmh.toFixed(1)} kilometres per hour!`;

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

async function clip(key: string, kmh?: number): Promise<Blob | null> {
  const req = `${FN}?line=${encodeURIComponent(key)}${kmh !== undefined ? `&kmh=${kmh.toFixed(1)}` : ''}`;
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

// Lines play one after another (a speed change is often "Pick it up!" then "Set it to 5.0"),
// so a new line never cuts off the one before it.
let chain: Promise<void> = Promise.resolve();
let queued = 0;
let generation = 0;

function playBlob(el: HTMLAudioElement, blob: Blob): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const done = (ok: boolean) => {
      clearTimeout(guard);
      el.onended = el.onerror = null;
      URL.revokeObjectURL(url);
      ok ? resolve() : reject(new Error('play failed'));
    };
    const guard = setTimeout(() => done(true), 15_000); // never let one clip block the queue
    el.onended = () => done(true);
    el.onerror = () => done(false);
    el.src = url;
    el.play().catch(() => done(false));
  });
}

async function playOne(key: string, kmh: number | undefined, gen: number, force: boolean): Promise<void> {
  if (gen !== generation) return; // stopped since this was queued
  const s = getSettings();
  if (!s.voiceOn && !force) return;
  const text = key === 'set' && kmh !== undefined ? speedText(kmh) : COACH_LINES[key] ?? key;
  if (s.coachVoice !== 'charlie') return speak(text, force);
  const el = player();
  // The normal voice is only a fallback for when Charlie cannot play at all,
  // so the safety reminders are never silent.
  if (!el || !(await coachVoiceAvailable())) return speak(text, force);
  const blob = await clip(key, kmh);
  if (!blob) return speak(text, force);
  try {
    await playBlob(el, blob);
  } catch {
    await speak(text, force); // autoplay blocked or decode error
  }
}

/**
 * Says one coach line (a key of COACH_LINES, or 'set' with a speed). With Charlie off, or when
 * Charlie cannot play, the normal voice says the same words. `force` speaks even with voice
 * guidance off (used only for the safety-key reminder, as before). Never throws.
 */
export function coachSay(key: string, kmh?: number, force = false): Promise<void> {
  if (queued >= 4) return Promise.resolve(); // never build a backlog of stale lines
  queued++;
  const gen = generation;
  chain = chain.then(() => playOne(key, kmh, gen, force)).catch(() => {}).finally(() => { queued--; });
  return chain;
}

/** Stops Charlie now and drops anything waiting (used when the voice is switched off). */
export function stopCoach() {
  generation++;
  try { audio?.pause(); } catch { /* ignore */ }
}

/** Rotates the four "push harder" lines so they don't repeat back to back. */
export const pushLine = (n: number) => `push${(((n % 4) + 4) % 4) + 1}`;
