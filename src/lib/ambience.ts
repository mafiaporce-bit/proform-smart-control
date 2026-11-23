// Nature sounds for the 3D park, made in the browser with Web Audio: wind in
// the leaves, birds, running water near the streams and the waterfall, and
// footsteps in time with the walker. No sound files are downloaded.

export interface AmbienceInput {
  moving: boolean;
  /** Steps per minute of the walker's current stride. */
  stepsPerMin: number;
  /** 0 to 1: how close the walker is to running water. */
  water: number;
  /** 0 to 1: how deep in the forest stretch the walker is. */
  forest: number;
}

class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private birdTimer: ReturnType<typeof setTimeout> | null = null;
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private input: AmbienceInput = { moving: false, stepsPerMin: 110, water: 0, forest: 0 };
  private leftFoot = false;
  running = false;

  /** Must be called from a tap (browsers only allow sound to start from a user action). */
  start() {
    if (this.running) return;
    try {
      const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx ?? new AC();
      this.ctx = ctx;
      void ctx.resume();
      if (!this.master) {
        const master = ctx.createGain();
        master.gain.value = 0;
        master.connect(ctx.destination);
        this.master = master;

        // two seconds of soft noise, reused for wind, water and footsteps
        const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) {
          const white = Math.random() * 2 - 1;
          last = (last + 0.04 * white) / 1.04; // gentle low-pass: brownish noise
          data[i] = last * 3.2 + white * 0.12;
        }
        this.noise = buf;

        const loop = (filterType: BiquadFilterType, freq: number, q: number) => {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          const f = ctx.createBiquadFilter();
          f.type = filterType; f.frequency.value = freq; f.Q.value = q;
          const g = ctx.createGain();
          g.gain.value = 0;
          src.connect(f); f.connect(g); g.connect(master);
          src.start();
          return { gain: g, filter: f };
        };
        const wind = loop('lowpass', 520, 0.4);
        this.windGain = wind.gain;
        // slow swell so the wind breathes
        const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
        lfo.frequency.value = 0.11; lfoGain.gain.value = 0.035;
        lfo.connect(lfoGain); lfoGain.connect(wind.gain.gain); lfo.start();
        this.waterGain = loop('bandpass', 1500, 0.5).gain;
      }
      const t = ctx.currentTime;
      this.master!.gain.cancelScheduledValues(t);
      this.master!.gain.setTargetAtTime(0.9, t, 0.6);
      this.running = true;
      this.apply();
      this.scheduleBird();
      this.scheduleStep();
    } catch {
      this.running = false; // no sound available: the park still works
    }
  }

  stop() {
    this.running = false;
    if (this.birdTimer) clearTimeout(this.birdTimer);
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.birdTimer = this.stepTimer = null;
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0, t, 0.25);
    }
  }

  update(input: AmbienceInput) {
    this.input = input;
    if (this.running) this.apply();
  }

  private apply() {
    if (!this.ctx || !this.windGain || !this.waterGain) return;
    const t = this.ctx.currentTime, i = this.input;
    this.windGain.gain.setTargetAtTime(0.07 + 0.05 * i.forest, t, 1.2);
    this.waterGain.gain.setTargetAtTime(Math.min(0.42, i.water * 0.42), t, 0.8);
  }

  private scheduleBird() {
    if (!this.running) return;
    const wait = (1400 + Math.random() * 4200) / (1 + this.input.forest * 1.2);
    this.birdTimer = setTimeout(() => {
      this.chirp();
      this.scheduleBird();
    }, wait);
  }

  private chirp() {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const notes = 2 + Math.floor(Math.random() * 4), base = 2300 + Math.random() * 2400;
    let t = ctx.currentTime + 0.02;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(this.master); }
    for (let n = 0; n < notes; n++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f0 = base * (0.85 + Math.random() * 0.4), len = 0.06 + Math.random() * 0.09;
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.35 : 0.72), t + len);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.028, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); g.connect(pan ?? this.master);
      o.start(t); o.stop(t + len + 0.02);
      t += len + 0.03 + Math.random() * 0.07;
    }
  }

  private scheduleStep() {
    if (!this.running) return;
    const spm = Math.min(220, Math.max(50, this.input.stepsPerMin));
    this.stepTimer = setTimeout(() => {
      if (this.input.moving) this.step();
      this.scheduleStep();
    }, 60_000 / spm);
  }

  /** One footfall on gravel: a short, soft burst of filtered noise. */
  private step() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || ctx.state !== 'running') return;
    this.leftFoot = !this.leftFoot;
    const t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    f.type = 'bandpass'; f.frequency.value = this.leftFoot ? 780 : 900; f.Q.value = 0.9;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.5, 0.14);
  }
}

export const ambience = new Ambience();

const bump = (d: number, width: number) => Math.exp(-Math.pow(d / width, 2));

/** How close the walker is to water and to the forest, from the position on the 3 km lap (metres). */
export function soundscapeAt(lapM: number) {
  const lap = 3000, away = (at: number) => { const d = Math.abs(lapM - at); return Math.min(d, lap - d); };
  const water = Math.max(bump(away(600), 45), bump(away(2100), 45), 1.0 * bump(away(1320), 85), 0.25 * bump(away(150), 220), 0.25 * bump(away(2820), 160));
  const forest = Math.max(bump(away(2340), 330), 0.6 * bump(away(1860), 180));
  return { water: Math.min(1, water), forest: Math.min(1, forest) };
}

/** Steps per minute for the clip the 3D person is playing at this pace (cadences measured from the model). */
export function stepsPerMinute(animation: string, pace: number) {
  const table: Record<string, [number, number]> = { relaxed: [120, 4.68], brisk: [138, 6.12], jog: [164, 10.08], run: [180, 16.2] };
  const row = table[animation];
  return row ? row[0] * (pace / row[1]) : 60 + pace * 12;
}
