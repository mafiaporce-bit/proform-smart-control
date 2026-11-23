// Voice guidance. Kokoro (kokoro-js, runs fully in the browser) when chosen,
// with the phone's built-in voice as the fallback so the app is never silent.

import { useSyncExternalStore } from 'react';
import { getSettings } from './settings';

const KOKORO_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js/+esm';
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export const KOKORO_VOICES: Array<{ id: string; label: string }> = [
  { id: 'af_heart', label: 'Heart (US, female)' },
  { id: 'af_bella', label: 'Bella (US, female)' },
  { id: 'af_nicole', label: 'Nicole (US, female)' },
  { id: 'am_michael', label: 'Michael (US, male)' },
  { id: 'am_fenrir', label: 'Fenrir (US, male)' },
  { id: 'bf_emma', label: 'Emma (UK, female)' },
  { id: 'bm_george', label: 'George (UK, male)' },
];

export type KokoroStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface KokoroInstance {
  generate(text: string, opts: { voice: string }): Promise<{ toBlob(): Blob }>;
}

let kokoro: KokoroInstance | null = null;
let loading: Promise<KokoroInstance> | null = null;
let status: KokoroStatus = 'idle';
let failReason = '';
const listeners = new Set<() => void>();
const setStatus = (s: KokoroStatus) => {
  status = s;
  listeners.forEach((fn) => fn());
};

export const useKokoroStatus = () =>
  useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => status,
  );
export const kokoroFailReason = () => failReason;

/** Downloads the voice model on first use (large, needs internet once). */
export function loadKokoro(): Promise<KokoroInstance> {
  if (kokoro) return Promise.resolve(kokoro);
  if (!loading) {
    setStatus('loading');
    const url = KOKORO_URL; // variable so the bundler leaves this as a runtime import
    loading = import(url)
      .then((mod: any) =>
        mod.KokoroTTS.from_pretrained(KOKORO_MODEL, {
          dtype: 'q8',
          device: 'gpu' in navigator ? 'webgpu' : 'wasm',
        }).catch(() => mod.KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: 'q8', device: 'wasm' })),
      )
      .then((tts: KokoroInstance) => {
        kokoro = tts;
        setStatus('ready');
        return tts;
      })
      .catch((e: unknown) => {
        loading = null;
        failReason = e instanceof Error ? e.message : String(e);
        setStatus('failed');
        throw e;
      });
  }
  return loading;
}

let audioEl: HTMLAudioElement | null = null;
let speakToken = 0;

function phoneSpeak(text: string) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1;
    window.speechSynthesis.speak(u);
  } catch { /* no voice available */ }
}

export function stopSpeaking() {
  speakToken++;
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  if (audioEl) audioEl.pause();
}

/**
 * Speaks a line. `force` ignores the voice on/off setting (used by the test button).
 * While Kokoro is still downloading, the phone voice is used instead.
 */
export async function speak(text: string, force = false) {
  const s = getSettings();
  if (!s.voiceOn && !force) return;
  const token = ++speakToken;
  if (s.voiceEngine !== 'kokoro') return phoneSpeak(text);
  if (!kokoro) {
    phoneSpeak(text);
    if (status !== 'failed') loadKokoro().catch(() => { /* fallback already spoke */ });
    return;
  }
  try {
    const audio = await kokoro.generate(text, { voice: s.kokoroVoice });
    if (token !== speakToken) return; // a newer line replaced this one
    if (!audioEl) audioEl = new Audio();
    const old = audioEl.src;
    audioEl.src = URL.createObjectURL(audio.toBlob());
    if (old.startsWith('blob:')) URL.revokeObjectURL(old);
    await audioEl.play();
  } catch {
    phoneSpeak(text);
  }
}
