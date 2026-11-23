import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/icons';
import { Card, ConnectButtons, PageHeader, SafetyNote, StatusPill, SupportWarning, go } from '../components/ui';
import { WalkScene } from '../components/WalkScene';
import { PlanPanel } from '../components/PlanPanel';
import { CHECKPOINTS, GAIT_PACE, PARK_3K, PARK_WALK, SECTIONS, gaitOf, type Gait } from '../lib/environments';
import {
  discardWorkout,
  finishWorkout,
  pauseWorkout,
  resumeWorkout,
  segEndSec,
  setLoggedSpeed,
  startWorkout,
  useWorkout,
} from '../lib/workout';
import { LEVELS, PROGRAMS, buildPlan, programById, type Level } from '../lib/programs';
import { useProfile, weekPlan } from '../lib/coach';
import { ambience, soundscapeAt, stepsPerMinute } from '../lib/ambience';
import { speak } from '../lib/voice';
import { setSettings, useSettings } from '../lib/settings';
import { useTreadmillSpeed } from '../ble/telemetry';
import { useCal } from '../ble/speedcal';
import { useBle } from '../ble/useBle';
import { duration, km } from '../lib/format';
import type { Workout } from '../db/db';

const PACE_MIN = 1;
const PACE_MAX = 16;
const LAP_M = PARK_3K.loopKm * 1000;

// ---- link to the 3D scene ------------------------------------------------
interface ParkStatus {
  phase: 'loading' | 'ready' | 'failed';
  error: string | null;
  landmark: string;
  character: string;
  characterNote: string;
  clips: string[];
  animation: string;
  route: Array<[number, number, number]>;
  /** True when the scene has drawn under 20 frames a second for a while. */
  slow: boolean;
  /** Photo textures that actually loaded, as "16/16". Empty until the scene reports it. */
  textures: string;
}
interface ParkCommand {
  pace: number;
  playing: boolean;
  meters: number;
  view: 'third' | 'first';
  quality: 'low' | 'medium' | 'high';
}

const hasWebGL = () => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
};

/**
 * Talks to the 3D park page in the iframe. The scene only draws: this app
 * tells it the pace, whether to move, and where on the lap the walker is.
 */
function usePark(frame: React.RefObject<HTMLIFrameElement | null>, cmd: ParkCommand, attempt: number) {
  const [st, setSt] = useState<ParkStatus>({
    phase: 'loading', error: null, landmark: '', character: 'fallback', characterNote: '', clips: [], animation: '', route: [], slow: false, textures: '',
  });
  const latest = useRef(cmd);
  latest.current = cmd;
  const send = () => {
    try {
      frame.current?.contentWindow?.postMessage({ type: 'VR_CMD', ...latest.current }, location.origin);
    } catch { /* frame not ready */ }
  };

  useEffect(() => {
    setSt((s) => ({ ...s, phase: 'loading', error: null }));
    if (!hasWebGL()) {
      setSt((s) => ({ ...s, phase: 'failed', error: 'This browser has 3D graphics (WebGL) switched off.' }));
      return;
    }
    let lastFrames = -1;
    let lastProgress = Date.now();
    let lowSince: number | null = null;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data;
      if (!d || d.source !== 'proform-park') return;
      if (d.type === 'VR_READY') {
        lastProgress = Date.now();
        setSt((s) => ({ ...s, phase: 'ready', error: null, route: Array.isArray(d.route) ? d.route : [] }));
        send();
      } else if (d.type === 'VR_STATE') {
        if (d.frames !== lastFrames) { lastFrames = d.frames; lastProgress = Date.now(); }
        // Slow drawing: under 20 frames a second for 7 seconds in a row, while the page is on screen.
        if (d.fps > 0 && d.fps < 20 && document.visibilityState === 'visible') lowSince = lowSince ?? Date.now();
        else if (d.fps >= 24) lowSince = null;
        const slow = lowSince !== null && Date.now() - lowSince > 7000;
        setSt((s) =>
          s.landmark === d.landmark && s.character === d.character && s.animation === d.animation && s.characterNote === d.characterNote && s.slow === slow && s.textures === (d.photoTextures ?? '')
            ? s
            : { ...s, landmark: d.landmark ?? '', character: d.character ?? 'fallback', characterNote: d.characterNote ?? '', clips: d.clips ?? [], animation: d.animation ?? '', slow, textures: d.photoTextures ?? '' },
        );
      } else if (d.type === 'VR_ERROR') {
        // Before the scene is up, an error means it cannot start. Afterwards the frame check below decides.
        setSt((s) => (s.phase === 'loading' ? { ...s, phase: 'failed', error: String(d.message ?? 'The 3D park could not start.') } : s));
      }
    };
    window.addEventListener('message', onMsg);
    const slow = setTimeout(() => {
      setSt((s) => (s.phase === 'loading' ? { ...s, phase: 'failed', error: 'The 3D park took too long to start.' } : s));
    }, 35000);
    // If the scene stops drawing for a while (and the page is on screen), fall back.
    const watch = setInterval(() => {
      if (document.visibilityState !== 'visible') { lastProgress = Date.now(); return; }
      if (Date.now() - lastProgress > 8000) {
        setSt((s) => (s.phase === 'ready' ? { ...s, phase: 'failed', error: 'The 3D park stopped drawing.' } : s));
      }
    }, 2000);
    const pump = setInterval(send, 400);
    return () => {
      window.removeEventListener('message', onMsg);
      clearTimeout(slow);
      clearInterval(watch);
      clearInterval(pump);
    };
  }, [attempt]);

  // Send straight away when something the user changed.
  useEffect(send, [cmd.pace, cmd.playing, cmd.view, cmd.quality, Math.round(cmd.meters / 5)]);
  return st;
}

function useFullscreen(target: React.RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(document.fullscreenElement === target.current && target.current !== null);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [target]);
  const toggle = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await target.current?.requestFullscreen({ navigationUI: 'hide' });
        // Turn the phone sideways for the wide view. Not every browser allows it; that is fine.
        try { await (screen.orientation as any)?.lock?.('landscape'); } catch { /* stays as it is */ }
      }
    } catch {
      /* fullscreen refused: stay inline */
    }
  };
  return { on, toggle, supported: typeof document !== 'undefined' && document.fullscreenEnabled };
}

// ---- small pieces --------------------------------------------------------
function RouteMap({ route, lapM, previewM }: { route: Array<[number, number, number]>; lapM: number; previewM: number | null }) {
  const view = useMemo(() => {
    if (route.length < 3) return null;
    const xs = route.map((p) => p[0]);
    const zs = route.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const W = 300, H = 170, pad = 14;
    const s = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxZ - minZ || 1));
    const pt = (p: [number, number, number]) => [W / 2 + (p[0] - (minX + maxX) / 2) * s, H / 2 + (p[1] - (minZ + maxZ) / 2) * s] as const;
    const pts = route.map(pt);
    const at = (m: number) => pts[Math.min(pts.length - 1, Math.floor((((m % LAP_M) + LAP_M) % LAP_M) / LAP_M * pts.length))];
    return { W, H, pts, at, d: pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ' Z' };
  }, [route]);
  if (!view) return null;
  const done = Math.max(1, Math.floor((lapM / LAP_M) * view.pts.length));
  const doneD = view.pts.slice(0, done + 1).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const me = view.at(lapM);
  const pv = previewM === null ? null : view.at(previewM);
  return (
    <svg viewBox={`0 0 ${view.W} ${view.H}`} className="mt-3 w-full" role="img" aria-label={`Route map. ${(lapM / 1000).toFixed(2)} of 3 km on this lap`}>
      <path d={view.d} fill="none" stroke="rgba(140,160,255,.2)" strokeWidth="7" strokeLinejoin="round" />
      <path d={doneD} fill="none" stroke="#22d3ee" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      {CHECKPOINTS.slice(1).map((c) => {
        const p = view.at(c.km * 1000);
        return <circle key={c.id} cx={p[0]} cy={p[1]} r="3.5" fill="#8f7bff" />;
      })}
      {pv && <circle cx={pv[0]} cy={pv[1]} r="6" fill="none" stroke="#fbbf24" strokeWidth="2" strokeDasharray="3 3" />}
      <circle cx={me[0]} cy={me[1]} r="7" fill="#e9eeff" stroke="#040714" strokeWidth="3" />
    </svg>
  );
}

function Summary({ w, onClose }: { w: Workout; onClose: () => void }) {
  return (
    <Card hot className="text-center">
      <div className="label text-good">Park session saved</div>
      <div className="digits mt-2 text-[40px] font-light leading-none">
        {km(w.distanceKm)} <span className="text-[15px] text-mute">km</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
        <div><div className="digits text-[18px] font-semibold">{duration(w.durationSec)}</div><div className="text-mute">time</div></div>
        <div><div className="digits text-[18px] font-semibold">{w.kcal}</div><div className="text-mute">est. kcal</div></div>
        <div><div className="digits text-[18px] font-semibold">{w.avgKmh.toFixed(1)}</div><div className="text-mute">avg km/h</div></div>
      </div>
      <p className="mt-2 text-[12.5px] text-mute">Worked out from the virtual pace you set, not measured by the treadmill.</p>
      <div className="mt-3 flex gap-2">
        <button className="btn flex-1" onClick={onClose}>Done</button>
        <button className="btn btn-primary flex-1" onClick={() => go('history')}>See history</button>
      </div>
    </Card>
  );
}

const SECTION_LINE: Record<string, string> = {
  lake: 'Lakeside park.',
  bridge: 'Coming up to the wooden bridge.',
  fall: 'Waterfall ahead.',
  hill: 'Hill and forest. The path climbs here.',
  return: 'Last stretch. Back towards the lake.',
};

const ANIM_LABEL: Record<string, string> = { idle: 'standing', relaxed: 'relaxed walk', brisk: 'brisk walk', jog: 'jog', run: 'run' };

function CharacterLine({ st }: { st: ParkStatus }) {
  if (st.phase !== 'ready') return null;
  let tone = 'text-mute';
  let text = 'Loading the 3D person (7 MB, first time only)…';
  if (st.character === 'maya') {
    tone = 'text-good';
    text = `3D person loaded: Maya${st.animation ? ` · ${ANIM_LABEL[st.animation] ?? st.animation}` : ''}`;
  } else if (st.character === 'model') {
    tone = 'text-good';
    text = '3D person loaded';
  } else if (st.character === 'model-static') {
    tone = 'text-warn';
    text = `3D person loaded, but its animation stopped (${st.characterNote}).`;
  } else if (st.characterNote) {
    tone = 'text-warn';
    text = 'The 3D person did not load. A simple stand-in figure is shown instead.';
  }
  // What the scene reports about its photo textures, e.g. "16/16". Shown as it is, so a missing file is visible.
  const [got, total] = st.textures.split('/').map(Number);
  const tex = !st.textures || !total ? '' : got === total ? ` · photo textures ${got}/${total}` : got === 0 ? ' · photo textures did not load (painted ones shown)' : ` · photo textures ${got}/${total} (rest painted)`;
  return (
    <p className={`mt-2 flex items-center gap-2 px-1 text-[12.5px] ${tone}`} role="status">
      <span className={`dot ${st.character === 'maya' || st.character === 'model' ? 'dot-live' : st.characterNote ? 'dot-bad' : 'dot-busy'}`} />
      {text}{tex}
    </p>
  );
}

// ---- the page ------------------------------------------------------------
export function VirtualRun() {
  const s = useBle();
  const w = useWorkout();
  const settings = useSettings();
  const treadmill = useTreadmillSpeed();
  const cal = useCal();
  const stage = useRef<HTMLDivElement | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const fs = useFullscreen(stage);
  const [attempt, setAttempt] = useState(0);
  const [previewOffset, setPreviewOffset] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<'end' | 'discard' | null>(null);
  const [saved, setSaved] = useState<Workout | null>(null);
  const [tooShort, setTooShort] = useState(false);
  const [programId, setProgramId] = useState(PROGRAMS[0].id);
  const [level, setLevel] = useState<Level>('standard');
  const profile = useProfile();

  const synced = treadmill !== null;
  const pace = synced ? treadmill : w.speedKmh;
  const active = w.status !== 'idle';
  const moving = w.status === 'running';
  const gait = gaitOf(pace);

  const lapM = active ? (w.distanceKm * 1000) % LAP_M : 0;
  const laps = active ? Math.floor((w.distanceKm * 1000) / LAP_M) : 0;
  const shownM = (((lapM + (previewOffset ?? 0)) % LAP_M) + LAP_M) % LAP_M;
  const lapKm = lapM / 1000;
  const section = SECTIONS.find((x) => lapKm >= x.at && lapKm < x.to) ?? SECTIONS[0];

  const park = usePark(frame, { pace, playing: moving, meters: shownM, view: settings.vrView, quality: settings.vrQuality }, attempt);
  const failed = park.phase === 'failed';

  const setPace = (v: number) => setLoggedSpeed(Math.min(PACE_MAX, Math.max(PACE_MIN, v)));
  const soundOn = () => { if (settings.vrSound && !failed) ambience.start(); };
  const begin = (planId?: string, planLevel?: Level, minutes?: number) => {
    setSaved(null);
    setTooShort(false);
    setPreviewOffset(null);
    const def = planId ? programById(planId) : undefined;
    startWorkout({ virtual: PARK_3K.name, plan: def ? buildPlan(def, planLevel ?? 'standard', settings.planMaxKmh, minutes) : null });
    soundOn();
  };
  const resume = () => { resumeWorkout(); soundOn(); };

  // Nature sounds follow the walker: footsteps at her cadence, water near the streams and the fall, more birds in the forest.
  useEffect(() => {
    ambience.update({ moving, stepsPerMin: stepsPerMinute(park.animation, pace), ...soundscapeAt(shownM) });
  }, [moving, pace, park.animation, Math.round(shownM / 10)]);
  useEffect(() => {
    if (!settings.vrSound || failed) ambience.stop();
  }, [settings.vrSound, failed]);
  useEffect(() => () => ambience.stop(), []);

  // Spoken notes when a new stretch of the park begins and when a lap is finished.
  const spokenSection = useRef<string | null>(null);
  const spokenLaps = useRef(0);
  useEffect(() => {
    if (!moving) { if (!active) { spokenSection.current = null; spokenLaps.current = 0; } return; }
    if (spokenSection.current === null) { spokenSection.current = section.id; spokenLaps.current = laps; return; }
    if (laps > spokenLaps.current) {
      spokenLaps.current = laps; spokenSection.current = section.id;
      if (settings.cheer) void speak(`Lap ${laps} done. That is ${laps * 3} kilometres. Back at the lakeside.`);
      return;
    }
    if (section.id !== spokenSection.current) {
      spokenSection.current = section.id;
      if (settings.cheer && !w.plan) void speak(SECTION_LINE[section.id] ?? section.name);
    }
  }, [moving, active, section.id, laps]);

  const seg = w.plan && !w.planDone ? w.plan.segments[w.segIndex] : null;
  const segLeft = seg && w.plan ? Math.max(0, Math.ceil(segEndSec(w.plan, w.segIndex) - w.activeMs / 1000)) : 0;
  const jumpTo = (kmAt: number) => setPreviewOffset(kmAt * 1000 - lapM);
  const otherWorkout = active && w.virtual !== PARK_3K.name;

  return (
    <>
      <PageHeader title="Virtual Running" sub={PARK_3K.name} back="home" right={<StatusPill />} />

      {saved && <div className="mb-4"><Summary w={saved} onClose={() => setSaved(null)} /></div>}
      {tooShort && <p className="mb-4 rounded-2xl border border-line bg-white/[0.04] p-3 text-[13px] text-mute">That session was under 10 seconds, so it was not saved.</p>}

      {/* Stage. In fullscreen this whole block fills the screen. */}
      <div ref={stage} className="vr-stage relative overflow-hidden rounded-[24px] border border-line bg-deep shadow-[0_24px_60px_-30px_rgba(34,211,238,.45)]">
        <div className="vr-scene relative aspect-[4/5] w-full">
          {failed ? (
            <WalkScene env={PARK_WALK} speedKmh={pace} moving={moving} className="absolute inset-0" />
          ) : (
            <iframe
              key={attempt}
              ref={frame}
              src={PARK_3K.src}
              title="Park Discovery 3K: 3D park route"
              className="pointer-events-none absolute inset-0 h-full w-full border-0"
              tabIndex={-1}
            />
          )}
          {park.phase === 'loading' && (
            <div className="absolute inset-0 grid place-items-center bg-deep">
              <div className="px-6 text-center">
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-cyan/25 border-t-cyan" />
                <div className="mt-3 font-semibold">Loading the 3D park…</div>
                <div className="mt-1 text-[12.5px] text-mute">Building the 3 km route.</div>
              </div>
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(4,7,20,.5)_0%,rgba(4,7,20,0)_20%,rgba(4,7,20,0)_62%,rgba(4,7,20,.78)_100%)]" />

        {/* Top bar */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3" style={{ paddingTop: fs.on ? 'calc(env(safe-area-inset-top) + 12px)' : undefined }}>
          <span className={`pill !border-transparent backdrop-blur-md ${synced ? '!bg-good/20 !text-good' : '!bg-warn/20 !text-warn'}`} role="status">
            <span className={`dot ${moving ? (synced ? 'dot-live' : 'dot-busy') : ''}`} />
            {synced ? 'TREADMILL SYNC' : 'SIMULATION MODE'}
          </span>
          <div className="flex gap-2">
            {!failed && (
              <button
                className="grid h-11 min-w-11 place-items-center rounded-full bg-ink/55 px-3 text-[12px] font-bold text-text backdrop-blur-md"
                onClick={() => setSettings({ vrView: settings.vrView === 'third' ? 'first' : 'third' })}
                aria-label={settings.vrView === 'third' ? 'Switch to first-person camera' : 'Switch to camera behind the person'}
              >
                {settings.vrView === 'third' ? '3RD' : '1ST'}
              </button>
            )}
            {!failed && (
              <button
                className="grid h-11 w-11 place-items-center rounded-full bg-ink/55 text-text backdrop-blur-md"
                onClick={() => { const on = !settings.vrSound; setSettings({ vrSound: on }); if (on) ambience.start(); else ambience.stop(); }}
                aria-label={settings.vrSound ? 'Turn nature sounds off' : 'Turn nature sounds on'}
                aria-pressed={settings.vrSound}
              >
                <Icon name={settings.vrSound ? 'volume' : 'mute'} size={20} />
              </button>
            )}
            {fs.supported && (
              <button className="grid h-11 w-11 place-items-center rounded-full bg-ink/55 text-text backdrop-blur-md" onClick={() => void fs.toggle()} aria-label={fs.on ? 'Exit fullscreen' : 'Fullscreen'}>
                <Icon name={fs.on ? 'minimize' : 'expand'} size={20} />
              </button>
            )}
          </div>
        </div>

        {/* Centre button when not moving */}
        {!moving && park.phase !== 'loading' && (
          <button
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
            onClick={() => (w.status === 'paused' ? resume() : active ? undefined : begin())}
            aria-label={w.status === 'paused' ? 'Resume' : 'Start park session'}
          >
            <span className="grid h-[76px] w-[76px] place-items-center rounded-full bg-gradient-to-br from-blue to-cyan text-[#03101f] shadow-[0_14px_40px_-8px_rgba(34,211,238,.9)]">
              <Icon name="play" size={30} />
            </span>
            <span className="rounded-full bg-ink/60 px-3 py-1 text-[13px] font-semibold backdrop-blur-md">
              {w.status === 'paused' ? 'Paused · tap to resume' : 'Start'}
            </span>
          </button>
        )}

        {/* Bottom HUD */}
        <div className={`absolute inset-x-0 bottom-0 p-3 ${fs.on ? 'mx-auto max-w-[560px] landscape:max-w-none' : ''}`} style={{ paddingBottom: fs.on ? 'calc(env(safe-area-inset-bottom) + 12px)' : undefined }}>
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-text/90">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${moving ? 'bg-cyan' : 'bg-dim'}`} />
              <span className="truncate">{failed ? 'Park Walk (photo)' : previewOffset !== null ? 'Preview' : park.landmark || section.name}</span>
            </span>
            <span className="digits shrink-0">{(shownM / 1000).toFixed(2)} / 3.00 km</span>
          </div>
          {seg && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-2xl bg-violet/25 px-3 py-1.5 text-[13px] font-semibold backdrop-blur-md" role="status">
              <span className="truncate">{seg.label}: set console to <span className="digits">{seg.kmh.toFixed(1)}</span> km/h</span>
              <span className="digits shrink-0">{duration(segLeft)}</span>
            </div>
          )}
          <div className={fs.on ? 'flex flex-col gap-2 landscape:flex-row landscape:items-stretch' : ''}>
          <div className="grid grid-cols-3 gap-2 landscape:flex-1">
            {[
              ['Time', duration(w.activeMs / 1000), ''],
              ['Distance', km(w.distanceKm), 'km'],
              [synced ? 'Treadmill' : 'Virtual pace', pace.toFixed(1), 'km/h'],
            ].map(([k, v, u]) => (
              <div key={k} className="rounded-2xl bg-ink/55 px-2.5 py-2 backdrop-blur-md">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-mute">{k}</div>
                <div className="digits text-[19px] font-semibold leading-tight">{v} <span className="text-[11px] font-medium text-mute">{u}</span></div>
              </div>
            ))}
          </div>
          {fs.on && (
            <div className="flex items-stretch gap-2 landscape:w-[38%]">
              <button className="btn btn-sm flex-1 !bg-ink/60 backdrop-blur-md" onClick={() => (moving ? pauseWorkout() : w.status === 'paused' ? resume() : begin())}>
                <Icon name={moving ? 'pause' : 'play'} size={16} /> {moving ? 'Pause' : w.status === 'paused' ? 'Resume' : 'Start'}
              </button>
              <button className="btn btn-sm w-12 !bg-ink/60 !px-0 backdrop-blur-md" disabled={synced} onClick={() => setPace(pace - 0.1)} aria-label="Lower virtual pace"><Icon name="minus" size={18} /></button>
              <button className="btn btn-sm w-12 !bg-ink/60 !px-0 backdrop-blur-md" disabled={synced} onClick={() => setPace(pace + 0.1)} aria-label="Raise virtual pace"><Icon name="plus" size={18} /></button>
            </div>
          )}
          </div>
        </div>
      </div>

      <CharacterLine st={park} />

      {failed && (
        <Card className="mt-3 !border-warn/40">
          <div className="font-semibold text-warn">The 3D park could not start</div>
          <p className="mt-1 text-[13px] text-mute">{park.error} Showing the photo Park Walk instead, so your session still works.</p>
          <button className="btn btn-sm mt-2" onClick={() => setAttempt((a) => a + 1)}><Icon name="refresh" size={16} /> Try the 3D park again</button>
        </Card>
      )}

      {park.slow && !failed && settings.vrQuality !== 'low' && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-line bg-white/[0.04] p-3 text-[13px] text-mute">
          <span className="flex-1">The park is drawing slowly on this device.</span>
          <button className="btn btn-sm shrink-0" onClick={() => setSettings({ vrQuality: 'low' })}>Use Low graphics</button>
        </div>
      )}

      {w.plan && <div className="mt-3"><PlanPanel /></div>}

      {previewOffset !== null && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-warn/30 bg-warn/[0.07] p-3 text-[13px] text-[#ffe9b0]">
          <span className="flex-1">Preview jump. Your recorded distance has not changed.</span>
          <button className="btn btn-sm shrink-0" onClick={() => setPreviewOffset(null)}>Back to my place</button>
        </div>
      )}

      {otherWorkout && (
        <p className="mt-3 rounded-2xl border border-line bg-white/[0.04] p-3 text-[13px] text-mute">
          {w.plan ? `Showing your ${w.plan.name} workout here. The plan still sets the pace at each change.` : 'Showing your current workout here.'}
        </p>
      )}

      {/* Gait + pace */}
      <Card className="mt-4">
        <div className="glass flex gap-1 !rounded-2xl p-1" role="group" aria-label="Gait">
          {(['walk', 'jog', 'run'] as Gait[]).map((g) => (
            <button
              key={g}
              aria-pressed={gait === g}
              disabled={synced}
              onClick={() => setPace(GAIT_PACE[g])}
              className={`flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-40 ${gait === g ? 'bg-gradient-to-r from-blue/40 to-cyan/30 text-text' : 'text-mute'}`}
            >
              <Icon name={g === 'walk' ? 'walk' : g === 'jog' ? 'wave' : 'bolt'} size={18} />
              {g === 'walk' ? 'Walk' : g === 'jog' ? 'Jog' : 'Run'}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="label">{synced ? 'Treadmill speed' : 'Virtual pace'}</span>
          <span className="pill">{synced ? 'From treadmill' : 'Set by you'}</span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button className="btn !min-h-[58px] w-[68px] !rounded-[18px]" disabled={synced} onClick={() => setPace(pace - 0.1)} aria-label="Lower virtual pace by 0.1"><Icon name="minus" size={24} /></button>
          <div className="flex-1 text-center">
            <span className="digits text-[48px] font-light leading-none">{pace.toFixed(1)}</span>
            <span className="ml-1 text-[13px] text-mute">km/h</span>
          </div>
          <button className="btn !min-h-[58px] w-[68px] !rounded-[18px]" disabled={synced} onClick={() => setPace(pace + 0.1)} aria-label="Raise virtual pace by 0.1"><Icon name="plus" size={24} /></button>
        </div>
        <input
          type="range"
          className="range mt-1"
          min={PACE_MIN}
          max={PACE_MAX}
          step={0.1}
          value={Math.min(PACE_MAX, Math.max(PACE_MIN, pace))}
          disabled={synced}
          onChange={(e: { target: { value: string } }) => setPace(Number(e.target.value))}
          aria-label="Virtual pace in km/h"
        />
        <div className="digits flex justify-between text-[11px] text-dim"><span>{PACE_MIN.toFixed(1)} km/h</span><span>{PACE_MAX.toFixed(1)} km/h</span></div>
        <p className="mt-2 text-[12.5px] text-mute">
          {synced
            ? 'The person, the distance and the calories follow the speed your treadmill reports. The app only reads it; change speed on the console.'
            : "This sets the person's pace and the distance count. It does not change the treadmill. Match it to your console for a true distance."}
        </p>
      </Card>

      {/* Actions */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {!active ? (
          <button className="btn btn-primary col-span-2 !min-h-[60px] text-[16px]" onClick={() => begin()}><Icon name="play" size={18} /> Start park session</button>
        ) : (
          <>
            {moving ? (
              <button className="btn !min-h-[58px]" onClick={pauseWorkout}><Icon name="pause" size={18} /> Pause</button>
            ) : (
              <button className="btn btn-primary !min-h-[58px]" onClick={resume}><Icon name="play" size={16} /> Resume</button>
            )}
            <button className="btn btn-violet !min-h-[58px]" onClick={() => setConfirm('end')}><Icon name="stop" size={15} /> End session</button>
          </>
        )}
      </div>

      {confirm && (
        <Card className="mt-3 !border-violet/40">
          <div className="font-semibold">{confirm === 'end' ? 'End and save this session?' : 'Throw this session away?'}</div>
          <p className="mt-1 text-[13px] text-mute">{confirm === 'end' ? 'Remember to stop the belt on the treadmill console.' : 'It will not be saved to your history.'}</p>
          <div className="mt-3 flex gap-2">
            <button className="btn flex-1" onClick={() => setConfirm(null)}>Keep going</button>
            {confirm === 'end' ? (
              <button
                className="btn btn-primary flex-1"
                onClick={async () => {
                  setConfirm(null);
                  setPreviewOffset(null);
                  const r = await finishWorkout();
                  setSaved(r);
                  setTooShort(r === null);
                }}
              >
                Save
              </button>
            ) : (
              <button className="btn btn-danger flex-1" onClick={() => { setConfirm(null); setPreviewOffset(null); discardWorkout(); }}>Discard</button>
            )}
          </div>
        </Card>
      )}
      {active && !confirm && (
        <button className="mx-auto mt-1 block min-h-11 px-4 text-[13px] text-dim underline underline-offset-4" onClick={() => setConfirm('discard')}>Discard session</button>
      )}

      {/* Guided programs */}
      {!active && (
        <Card className="mt-4">
          <div className="label">Guided program in the park</div>
          <p className="mt-1 text-[12.5px] text-mute">The coach voice tells you each speed change while you walk the route. You set the speed on the console.</p>
          {profile && (
            <div className="mt-3 space-y-2">
              {weekPlan(profile).slice(0, 3).map((x, i) => (
                <button key={i} className="btn btn-sm w-full !justify-between" onClick={() => begin(x.programId, x.level, x.minutes)} aria-label={`Start coach session ${x.programName} in the park`}>
                  <span className="truncate"><span className="text-cyan">{x.day}</span> · {x.programName}</span>
                  <span className="shrink-0 text-[12px] font-normal text-mute">{LEVELS.find((l) => l.id === x.level)?.label} · {x.minutes} min</span>
                </button>
              ))}
              <div className="text-[12px] text-dim">From your coach plan.</div>
            </div>
          )}
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <select className="field" value={programId} onChange={(e: { target: { value: string } }) => setProgramId(e.target.value)} aria-label="Program">
              {PROGRAMS.map((p) => <option key={p.id} value={p.id} className="bg-panel">{p.name}</option>)}
            </select>
            <select className="field !w-[112px]" value={level} onChange={(e: { target: { value: string } }) => setLevel(e.target.value as Level)} aria-label="Level">
              {LEVELS.map((l) => <option key={l.id} value={l.id} className="bg-panel">{l.label}</option>)}
            </select>
          </div>
          <button className="btn btn-violet mt-2 w-full" onClick={() => begin(programId, level)}><Icon name="list" size={18} /> Start guided program</button>
        </Card>
      )}

      {/* Checkpoints */}
      {!failed && (
        <Card className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="label">Jump to a checkpoint</span>
            <span className="text-[12px] text-mute">preview only</span>
          </div>
          <div className="mt-2.5 grid grid-cols-5 gap-1.5">
            {CHECKPOINTS.map((c) => (
              <button key={c.id} className="btn btn-sm !h-auto flex-col !gap-0 !px-0 py-1.5" onClick={() => jumpTo(c.km - (c.lead ?? 0))} aria-label={`Preview ${c.label} at ${c.km.toFixed(1)} km`}>
                <span className="text-[12px]">{c.label}</span>
                <span className="digits text-[10.5px] font-normal text-mute">{c.km.toFixed(1)} km</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Route */}
      <Card className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="label">3 km route</span>
          <span className="digits text-[13px] font-semibold text-cyan">{laps > 0 ? `Lap ${laps + 1} · ` : ''}{lapKm.toFixed(2)} km · {Math.floor((lapM / LAP_M) * 100)}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={Number(lapKm.toFixed(2))}>
          <div className="h-full rounded-full bg-gradient-to-r from-blue via-cyan to-violet transition-[width] duration-500" style={{ width: `${(lapM / LAP_M) * 100}%` }} />
        </div>
        <RouteMap route={park.route} lapM={lapM} previewM={previewOffset === null ? null : shownM} />
        <ol className="mt-3 space-y-1.5">
          {SECTIONS.map((x) => {
            const here = active && x.id === section.id;
            const done = active && lapKm >= x.to;
            return (
              <li key={x.id} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] ${here ? 'bg-cyan/10' : ''}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${here ? 'bg-cyan' : done ? 'bg-good' : 'bg-white/20'}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block font-semibold ${here ? 'text-cyan' : ''}`}>{x.name}</span>
                  <span className="block truncate text-[12px] text-mute">{x.note}</span>
                </span>
                <span className="digits shrink-0 text-[12px] text-mute">{x.at.toFixed(1)} to {x.to.toFixed(1)} km</span>
              </li>
            );
          })}
        </ol>
      </Card>

      {/* Graphics */}
      {!failed && (
        <Card className="mt-4">
          <div className="label">Graphics</div>
          <div className="glass mt-2 flex gap-1 !rounded-2xl p-1" role="group" aria-label="Graphics quality">
            {(['low', 'medium', 'high'] as const).map((q) => (
              <button key={q} aria-pressed={settings.vrQuality === q} onClick={() => setSettings({ vrQuality: q })} className={`min-h-11 flex-1 rounded-xl text-[13.5px] font-semibold ${settings.vrQuality === q ? 'bg-white/10' : 'text-mute'}`}>
                {q === 'low' ? 'Low' : q === 'medium' ? 'Medium' : 'High'}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-mute">Low turns shadows off and is easiest on the battery. High is sharper with finer shadows. Pick Low if the park stutters.</p>
          <div className="glass mt-3 flex gap-1 !rounded-2xl p-1" role="group" aria-label="Camera">
            {(['third', 'first'] as const).map((v) => (
              <button key={v} aria-pressed={settings.vrView === v} onClick={() => setSettings({ vrView: v })} className={`min-h-11 flex-1 rounded-xl text-[13.5px] font-semibold ${settings.vrView === v ? 'bg-white/10' : 'text-mute'}`}>
                {v === 'third' ? 'Behind the person' : 'First person'}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-4"><SafetyNote compact /></div>

      <Card className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="label">Treadmill speed sync</span>
          <span className={`pill ${synced ? '!text-good' : '!text-warn'}`}>{synced ? 'Live' : cal ? 'Ready' : 'Not verified'}</span>
        </div>
        <p className="mt-2 text-[13px] text-mute">
          {synced
            ? `The treadmill reports ${treadmill!.toFixed(1)} km/h and the person follows it. The app only reads the speed; change it on the console.`
            : cal
              ? s.status === 'connected'
                ? settings.telemetryLink ? 'Connected. Waiting for the treadmill to report its speed. Until it does, the park uses the pace you set.' : 'Connected, but the telemetry link is switched off in the Bluetooth Lab, so the park uses the pace you set.'
                : 'Speed is verified. Connect the treadmill and the person follows the real belt speed. Without a connection the park runs in Simulation Mode on the pace you set.'
              : 'The person can follow your real belt speed after a one-time speed check in the Bluetooth Lab (three speeds compared with the console). Until then the park runs in Simulation Mode on the pace you set.'}{' '}
          Pause and End here stop the app's session only. They do not stop the belt.
        </p>
        <div className="mt-3 space-y-2">
          <SupportWarning />
          <ConnectButtons small />
          <button className="btn btn-sm w-full" onClick={() => go('diagnostics')}><Icon name="flask" size={16} /> Open Bluetooth Lab</button>
        </div>
      </Card>

      <p className="mt-4 px-1 text-[12px] text-dim">
        3D person: "Maya" from Innerscene, public domain (CC0). 3D engine: Three.js, MIT licence. Sky, lawn, leaves, bark, path and rock textures: Poly Haven, public domain (CC0). Park shapes, flowers and nature sounds are generated by code.
      </p>
    </>
  );
}
