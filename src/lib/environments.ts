// Virtual Running environments.
//
// Park Discovery 3K is the 3D park: a continuous 3 km route drawn with
// Three.js in /virtual-park/, with the Maya 3D person. Park Walk is the older
// photo loop, kept only as the automatic stand-in when 3D cannot start.

export interface VirtualEnvironment {
  id: string;
  name: string;
  place: string;
  /** Frames of the walking loop, in order. */
  frames: string[];
  poster: string;
  /** Length of one lap of the virtual route, for the progress bar. */
  loopKm: number;
  /** Frames per second of the loop at the reference pace. */
  fpsAtRef: number;
  refKmh: number;
}

/** Photo loop used when the 3D park cannot start (no internet on first use, no WebGL). */
export const PARK_WALK: VirtualEnvironment = {
  id: 'park',
  name: 'Park Walk',
  place: 'Riverside trail · Morning light',
  frames: Array.from({ length: 6 }, (_, i) => `/virtual/park/walk-${i}.webp`),
  poster: '/virtual/park/poster.jpg',
  loopKm: 2.5,
  fpsAtRef: 5.3,
  refKmh: 4.5,
};

export const PARK_3K = {
  id: 'park3k',
  name: 'Park Discovery 3K',
  src: '/virtual-park/',
  loopKm: 3,
};

/** Route sections, in the order they are met. `at` and `to` are km along the 3 km lap. */
export const SECTIONS: Array<{ id: string; name: string; at: number; to: number; note: string }> = [
  { id: 'lake', name: 'Lakeside Park', at: 0, to: 0.6, note: 'Gardens, benches, lampposts and the lake' },
  { id: 'bridge', name: 'Bridge and River', at: 0.6, to: 1.3, note: 'Over the wooden bridge and along the stream' },
  { id: 'fall', name: 'Waterfall', at: 1.3, to: 1.9, note: 'Rocks, pool and falling water' },
  { id: 'hill', name: 'Hill and Forest', at: 1.9, to: 2.5, note: 'Uphill, second bridge and tall trees' },
  { id: 'return', name: 'Return to Park', at: 2.5, to: 3.0, note: 'Pine grove, then back to the lakeside start' },
];

/** Preview jumps. The km values match where the scene places each landmark. */
/** `lead` starts the preview a little before the landmark, so you walk up to it. */
export const CHECKPOINTS: Array<{ id: string; label: string; km: number; lead?: number }> = [
  { id: 'lake', label: 'Lakeside', km: 0 },
  { id: 'bridge', label: 'Bridge', km: 0.6, lead: 0.03 },
  { id: 'fall', label: 'Waterfall', km: 1.32, lead: 0.07 },
  { id: 'hill', label: 'Hill', km: 1.86, lead: 0.12 },
  { id: 'forest', label: 'Forest', km: 2.49, lead: 0.02 },
];

export type Gait = 'walk' | 'jog' | 'run';

/** Virtual pace for each gait button, in km/h. Chosen to sit inside the 3D person's walk, jog and run clips. */
export const GAIT_PACE: Record<Gait, number> = { walk: 4.5, jog: 8.5, run: 12.5 };

export const gaitOf = (kmh: number): Gait => (kmh < 7.3 ? 'walk' : kmh < 12 ? 'jog' : 'run');
