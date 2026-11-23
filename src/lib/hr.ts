// Heart-rate strap or band over the standard Bluetooth Heart Rate service.
// Listen-only: subscribes to heart_rate_measurement, writes nothing.
// Separate from the treadmill link. Not yet tested on real hardware.

import { useSyncExternalStore } from 'react';

export type HrStatus = 'idle' | 'choosing' | 'connecting' | 'connected' | 'disconnected' | 'error';
export interface HrState {
  status: HrStatus;
  name: string | null;
  bpm: number | null;
  lastAt: number | null;
  error: string | null;
}

let state: HrState = { status: 'idle', name: null, bpm: null, lastAt: null, error: null };
const listeners = new Set<() => void>();
let device: BluetoothDevice | null = null;
let staleTimer: ReturnType<typeof setInterval> | null = null;

const set = (patch: Partial<HrState>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};

export const useHr = () =>
  useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => state,
  );

/** Heart Rate Measurement: bit 0 of the flags byte says whether the value is 8 or 16 bits. */
export function parseHeartRate(v: DataView): number | null {
  if (v.byteLength < 2) return null;
  const sixteen = (v.getUint8(0) & 0x01) === 1;
  if (sixteen && v.byteLength < 3) return null;
  const bpm = sixteen ? v.getUint16(1, true) : v.getUint8(1);
  return bpm > 0 && bpm < 255 ? bpm : null;
}

/** A reading newer than 6 seconds, or null. Never a remembered or guessed value. */
export function currentBpm(): number | null {
  if (state.status !== 'connected' || state.bpm === null || state.lastAt === null) return null;
  return Date.now() - state.lastAt < 6000 ? state.bpm : null;
}

const onValue = (ev: Event) => {
  const v = (ev.target as BluetoothRemoteGATTCharacteristic).value;
  if (!v) return;
  const bpm = parseHeartRate(v);
  if (bpm !== null) set({ bpm, lastAt: Date.now() });
};

const onGone = () => {
  if (staleTimer) { clearInterval(staleTimer); staleTimer = null; }
  set({ status: 'disconnected', bpm: null });
};

export async function connectHr() {
  if (!navigator.bluetooth || ['choosing', 'connecting', 'connected'].includes(state.status)) return;
  set({ status: 'choosing', error: null });
  try {
    const d = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    if (device && device !== d) device.removeEventListener('gattserverdisconnected', onGone);
    device = d;
    d.addEventListener('gattserverdisconnected', onGone);
    set({ status: 'connecting', name: d.name ?? 'Heart-rate sensor' });
    const server = await d.gatt!.connect();
    const service = await server.getPrimaryService('heart_rate');
    const ch = await service.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', onValue);
    await ch.startNotifications();
    set({ status: 'connected' });
    if (!staleTimer) {
      staleTimer = setInterval(() => {
        if (state.bpm !== null && state.lastAt !== null && Date.now() - state.lastAt > 6000) set({ bpm: null });
      }, 2000);
    }
  } catch (e) {
    const cancelled = e instanceof Error && e.name === 'NotFoundError';
    set({
      status: cancelled ? (state.name ? 'disconnected' : 'idle') : 'error',
      bpm: null,
      error: cancelled ? null : e instanceof Error ? e.message : String(e),
    });
  }
}

export function disconnectHr() {
  if (device?.gatt?.connected) device.gatt.disconnect();
  else set({ status: state.name ? 'disconnected' : 'idle', bpm: null });
}
