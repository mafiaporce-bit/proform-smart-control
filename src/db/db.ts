// Local storage in IndexedDB: workouts and saved Bluetooth sessions.

export interface SpeedSample {
  /** Seconds from the start of the workout (active time). */
  t: number;
  kmh: number;
}

export interface Workout {
  id?: number;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  distanceKm: number;
  kcal: number;
  avgKmh: number;
  maxKmh: number;
  inclinePct: number;
  /** Where the speed figures came from. Always "manual" until telemetry is validated. */
  /** 'treadmill' = speed came from the treadmill's own verified telemetry for most of the workout. */
  source: 'manual' | 'treadmill';
  samples: SpeedSample[];
  note?: string;
  /** Name of the guided program, if one was used. */
  program?: string;
  /** Virtual Running environment shown during the workout, e.g. "Park Walk". */
  virtual?: string;
  /** From a Bluetooth heart-rate strap, when one was connected. */
  avgHr?: number;
  maxHr?: number;
}

export interface BleSessionRecord {
  id?: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  packets: number;
  userEnded: boolean;
  deviceName: string;
  log: unknown[];
}

const DB_NAME = 'proform-smart-control';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('workouts')) {
          db.createObjectStore('workouts', { keyPath: 'id', autoIncrement: true }).createIndex('startedAt', 'startedAt');
        }
        if (!db.objectStoreNames.contains('bleSessions')) {
          db.createObjectStore('bleSessions', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

const done = <T,>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function store(name: string, mode: IDBTransactionMode) {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

// Lets pages refresh when data changes.
const listeners = new Set<() => void>();
export const onDbChange = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};
const changed = () => listeners.forEach((fn) => fn());

export async function addWorkout(w: Workout) {
  const id = await done((await store('workouts', 'readwrite')).add(w));
  changed();
  return id as number;
}

export async function listWorkouts(): Promise<Workout[]> {
  const all = await done((await store('workouts', 'readonly')).getAll());
  return (all as Workout[]).sort((a, b) => b.startedAt - a.startedAt);
}

export async function deleteWorkout(id: number) {
  await done((await store('workouts', 'readwrite')).delete(id));
  changed();
}

export async function clearWorkouts() {
  await done((await store('workouts', 'readwrite')).clear());
  changed();
}

const MAX_SESSIONS = 30;

export async function saveBleSession(s: BleSessionRecord) {
  const st = await store('bleSessions', 'readwrite');
  await done(st.add(s));
  const keys = await done(st.getAllKeys());
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SESSIONS))) st.delete(k);
  changed();
}

export async function listBleSessions(): Promise<BleSessionRecord[]> {
  const all = await done((await store('bleSessions', 'readonly')).getAll());
  return (all as BleSessionRecord[]).sort((a, b) => b.startedAt - a.startedAt);
}

export async function clearBleSessions() {
  await done((await store('bleSessions', 'readwrite')).clear());
  changed();
}
