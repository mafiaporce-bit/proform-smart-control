// Workout dashboard: speedometer, coach card and stats. APPEARANCE ONLY.
// Every number here comes from the existing engine:
//   - speed: the verified treadmill reading (useTreadmillSpeed) when there is one, otherwise the
//     speed the user entered (or the plan's speed), and it is labelled as such, never as "live";
//   - target: the current guided-plan block;
//   - the caption: the words the coach last said (lib/coachline), plus a pace hint.
// Nothing here talks to the treadmill or changes what the coach says.

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { StatusPill } from './ui';
import { useWorkout } from '../lib/workout';
import { setSettings, useSettings } from '../lib/settings';
import { useTreadmillSpeed } from '../ble/telemetry';
import { useCal } from '../ble/speedcal';
import { useBle } from '../ble/useBle';
import { connectHr, useHr } from '../lib/hr';
import { useCoachLine } from '../lib/coachline';
import { duration, km } from '../lib/format';

/** How close counts as "on pace", in km/h (same as the pace-match card). */
export const TOL = 0.3;

export type Pace = 'below' | 'on' | 'above' | null;

export function useDash() {
  const w = useWorkout();
  const real = useTreadmillSpeed();
  const cal = useCal();
  const ble = useBle();
  const hr = useHr();
  const live = real !== null;
  const speed = live ? real : w.speedKmh;
  const seg = w.plan && !w.planDone ? w.plan.segments[w.segIndex] : null;
  const target = seg ? seg.kmh : null;
  const pace: Pace = live && target !== null ? (Math.abs(speed - target) <= TOL ? 'on' : speed < target ? 'below' : 'above') : null;
  const source = live ? 'Live from treadmill' : w.plan ? 'Plan speed · not measured' : 'Entered by you';
  const noLiveHint = !cal
    ? 'Do the one-time speed check in the Bluetooth Lab to get a live reading.'
    : ble.status === 'connected'
      ? 'Waiting for the treadmill to report its speed…'
      : 'Connect the treadmill for a live reading.';
  return { w, speed, live, target, seg, pace, source, noLiveHint, hr };
}

/** Eases a number towards its new value, for the digital read-out. */
export function useTween(value: number, ms = 650) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { from.current = value; setShown(value); return; }
    const start = performance.now();
    const a = from.current;
    cancelAnimationFrame(raf.current);
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const v = a + (value - a) * (1 - Math.pow(1 - k, 3));
      from.current = v;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, ms]);
  return shown;
}

// ---- Speedometer ---------------------------------------------------------
const C = 150; // centre of the 300x300 view box
const START = 135; // degrees, SVG convention (0 = right, clockwise)
const SWEEP = 270;
const rad = (d: number) => (d * Math.PI) / 180;
const pt = (deg: number, r: number) => [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))] as const;
const arc = (a0: number, a1: number, r: number) => {
  const [x0, y0] = pt(a0, r);
  const [x1, y1] = pt(a1, r);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
/** blue → cyan → green → amber → red along the dial */
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [59, 130, 255]], [0.3, [34, 211, 238]], [0.55, [52, 211, 153]], [0.75, [251, 191, 36]], [1, [244, 63, 94]],
];
const colorAt = (f: number) => {
  for (let i = 1; i < STOPS.length; i++) {
    const [f1, c1] = STOPS[i];
    const [f0, c0] = STOPS[i - 1];
    if (f <= f1) {
      const k = (f - f0) / (f1 - f0);
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(' ')})`;
    }
  }
  return 'rgb(244 63 94)';
};
const SEGS = 54;

export function scaleMax(speed: number, target: number | null) {
  return Math.max(speed, target ?? 0) > 9.5 ? 16 : 10;
}

export function Speedometer({ speed, target, source, live, compact = false }: { speed: number; target: number | null; source: string; live: boolean; compact?: boolean }) {
  const max = scaleMax(speed, target);
  const shown = useTween(speed);
  const f = Math.max(0, Math.min(1, speed / max));
  const angle = START + SWEEP * f;
  const majorStep = max > 10 ? 2 : 1;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-6; v += 0.5) ticks.push(Math.round(v * 10) / 10);
  const segLen = SWEEP / SEGS;
  const tf = target !== null ? Math.max(0, Math.min(1, target / max)) : null;

  return (
    <div className="gauge-box relative" role="img" aria-label={`Speed ${speed.toFixed(1)} kilometres per hour${target !== null ? `, target ${target.toFixed(1)}` : ''}. ${source}.`}>
      <svg viewBox="0 0 300 300" className="block h-auto w-full" aria-hidden="true">
        <defs>
          <radialGradient id="g-face" cx="50%" cy="45%" r="60%">
            <stop offset="0" stopColor="#0e1d44" />
            <stop offset="1" stopColor="#040816" />
          </radialGradient>
          <filter id="g-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        {/* bezel + face */}
        <circle cx={C} cy={C} r="146" fill="#091331" stroke="rgb(34 211 238 / .35)" strokeWidth="1.5" />
        <circle cx={C} cy={C} r="138" fill="url(#g-face)" stroke="rgb(140 160 255 / .18)" strokeWidth="1" />

        {/* coloured dial: dim track, bright up to the current speed */}
        {Array.from({ length: SEGS }, (_, i) => {
          const a0 = START + i * segLen + 0.4;
          const a1 = START + (i + 1) * segLen - 0.4;
          const lit = (i + 0.5) / SEGS <= f;
          return (
            <path
              key={i}
              d={arc(a0, a1, 118)}
              stroke={colorAt((i + 0.5) / SEGS)}
              strokeWidth="9"
              fill="none"
              style={{ opacity: lit ? 1 : 0.22, transition: 'opacity .5s' }}
            />
          );
        })}
        <path d={arc(START, Math.max(START + 0.5, angle), 118)} stroke={colorAt(f)} strokeWidth="9" fill="none" filter="url(#g-glow)" opacity=".55" />

        {/* ticks and labels */}
        {ticks.map((v) => {
          const a = START + SWEEP * (v / max);
          const major = Math.abs(v / majorStep - Math.round(v / majorStep)) < 1e-6;
          const [x0, y0] = pt(a, major ? 100 : 104);
          const [x1, y1] = pt(a, 110);
          const [lx, ly] = pt(a, 84);
          return (
            <g key={v}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={major ? 'rgb(233 238 255 / .8)' : 'rgb(233 238 255 / .3)'} strokeWidth={major ? 2 : 1} strokeLinecap="round" />
              {major && !compact && (
                <text x={lx} y={ly} fill="rgb(233 238 255 / .78)" fontSize="13" fontWeight="600" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-sans)">
                  {max > 10 ? v : v.toFixed(1)}
                </text>
              )}
            </g>
          );
        })}

        {/* target marker */}
        {tf !== null && (() => {
          const a = START + SWEEP * tf;
          const [x, y] = pt(a, 118);
          return (
            <g>
              <circle cx={x} cy={y} r="11" fill="#04140f" stroke="#34d399" strokeWidth="3" />
              <circle cx={x} cy={y} r="16" fill="none" stroke="rgb(52 211 153 / .45)" strokeWidth="2" filter="url(#g-glow)" />
            </g>
          );
        })()}

        {/* needle */}
        <g className="needle" style={{ transform: `rotate(${angle - 270}deg)` }}>
          <path d={`M${C - 4.5} ${C} L${C} ${C - 108} L${C + 4.5} ${C} Z`} fill="#e9eeff" />
          <path d={`M${C - 1.6} ${C} L${C} ${C - 106} L${C + 1.6} ${C} Z`} fill="#22d3ee" />
        </g>
        <circle cx={C} cy={C} r="11" fill="#0b1636" stroke="#22d3ee" strokeWidth="2.5" />
        <circle cx={C} cy={C} r="4" fill="#e9eeff" />
      </svg>

      {/* digital read-out */}
      <div className="gauge-read pointer-events-none absolute inset-x-0 bottom-[8%] flex flex-col items-center">
        <span className="gr-label font-semibold uppercase tracking-[0.14em] text-mute">Speed</span>
        <span className="gr-num digits font-bold leading-none tracking-tight [text-shadow:0_0_22px_rgb(34_211_238/.45)]">{shown.toFixed(1)}</span>
        <span className="gr-unit text-mute">km/h</span>
        <span className={`gr-chip mt-[1.2cqw] inline-flex items-center gap-1.5 rounded-full border px-[2.6cqw] py-[0.8cqw] font-semibold ${live ? 'border-good/40 bg-good/10 text-good' : 'border-line bg-white/[0.04] text-mute'}`}>
          <span className={`dot ${live ? 'dot-live' : ''}`} /> {source}
        </span>
      </div>

      {target !== null && (
        <div className="absolute right-0 top-1 rounded-xl border border-good/50 bg-[#04140f]/90 px-2.5 py-1 text-right shadow-[0_0_18px_-6px_rgb(52_211_153/.8)]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-good/80">Target</div>
          <div className="digits text-[17px] font-bold leading-tight text-good">{target.toFixed(1)} <span className="text-[11px] font-medium">km/h</span></div>
        </div>
      )}
    </div>
  );
}

// ---- Coach card ----------------------------------------------------------
export function coachMessage(d: ReturnType<typeof useDash>): { head: string; sub: string } {
  const t = d.target?.toFixed(1);
  if (d.w.status === 'paused') return { head: 'Paused.', sub: 'Take a breath. Tap Resume when you are ready.' };
  if (d.w.planDone) return { head: 'Plan complete!', sub: 'Slow down, stop the belt on the console, then tap Finish.' };
  if (d.pace === 'below') return { head: 'Pick it up!', sub: `Increase to ${t} km/h on the console.` };
  if (d.pace === 'on') return { head: "That's your pace.", sub: `Hold ${t} km/h. Keep it steady.` };
  if (d.pace === 'above') return { head: 'Ease back a little.', sub: `Relax and settle into ${t} km/h.` };
  if (t) return { head: `Set the console to ${t} km/h.`, sub: d.noLiveHint };
  return d.live
    ? { head: 'You set the pace.', sub: 'Reading your speed from the treadmill.' }
    : { head: 'You set the pace.', sub: 'Keep the speed below matched to your console.' };
}

function AvatarSwitch({ className = '' }: { className?: string }) {
  const s = useSettings();
  return (
    <div className={`flex gap-1.5 ${className}`} role="group" aria-label="Coach picture">
      {(['female', 'male'] as const).map((g) => {
        const on = s.coachAvatar === g;
        return (
          <button
            key={g}
            className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-[12.5px] font-semibold transition-colors ${on ? 'border-cyan bg-cyan/15 text-cyan' : 'border-line bg-white/[0.04] text-mute'}`}
            aria-pressed={on}
            onClick={() => setSettings({ coachAvatar: g })}
          >
            {g === 'female' ? 'Female' : 'Male'}{on && ' ✓'}
          </button>
        );
      })}
    </div>
  );
}

export function CoachCard({ d, layout = 'side' }: { d: ReturnType<typeof useDash>; layout?: 'side' | 'banner' }) {
  const s = useSettings();
  const line = useCoachLine();
  const msg = coachMessage(d);
  const recent = line && Date.now() - line.at < 20_000 ? line.text : null;
  const head = recent ? `“${recent}”` : msg.head;
  const src = s.coachAvatar === 'female' ? '/coach/female.webp' : '/coach/male.webp';
  return (
    <div className={`neon relative flex items-stretch overflow-hidden ${layout === 'banner' ? 'min-h-[132px]' : 'min-h-[150px]'}`}>
      <div className="relative w-[34%] max-w-[150px] shrink-0">
        <img src={src} alt={`${s.coachAvatar === 'female' ? 'Female' : 'Male'} coach`} className="absolute inset-0 h-full w-full object-cover object-top" width={270} height={308} decoding="async" />
        <span className="absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-transparent to-[#081430]" />
      </div>
      <div className="min-w-0 flex-1 p-3 pl-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-cyan">
          <Icon name="wave" size={15} /> AI Coach
        </div>
        <p className={`mt-1 line-clamp-4 font-bold italic leading-snug ${head.length > 60 ? 'text-[15.5px]' : 'text-[clamp(17px,5vw,21px)]'}`} aria-live="polite">{head}</p>
        <p className="mt-1 text-[13px] italic text-mute">{msg.sub}</p>
        <AvatarSwitch className="mt-2.5" />
      </div>
    </div>
  );
}

// ---- Pace banner -----------------------------------------------------------
export function PaceBanner({ d }: { d: ReturnType<typeof useDash> }) {
  if (d.target === null) return null;
  const t = d.target.toFixed(1);
  const v =
    d.pace === 'below'
      ? { cls: 'neon-bad', tone: 'text-bad', title: 'Below target pace', sub: `Increase your speed to reach ${t} km/h`, icon: 'route' }
      : d.pace === 'on'
        ? { cls: 'neon-good', tone: 'text-good', title: 'On target ✓', sub: `Hold ${t} km/h`, icon: 'route' }
        : d.pace === 'above'
          ? { cls: 'neon-warn', tone: 'text-warn', title: 'Above target', sub: `Slightly fast. Ease back to ${t} km/h`, icon: 'route' }
          : { cls: '', tone: 'text-cyan', title: `Target ${t} km/h`, sub: `Set it on the console. ${d.noLiveHint}`, icon: 'route' };
  return (
    <div className={`neon ${v.cls} flex items-center gap-3 p-3`} role="status">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border border-current ${v.tone}`}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>
      </span>
      <div className="min-w-0">
        <div className={`text-[16px] font-bold italic ${v.tone}`}>{v.title}</div>
        <div className="text-[12.5px] text-mute">{v.sub}</div>
      </div>
      {d.live && (
        <div className="ml-auto text-right">
          <div className="digits text-[15px] font-semibold">{d.speed.toFixed(1)}</div>
          <div className="text-[11px] text-mute">/ {t} km/h</div>
        </div>
      )}
    </div>
  );
}

// ---- Stats ---------------------------------------------------------------
export function StatsPanel({ d, cols = 2 }: { d: ReturnType<typeof useDash>; cols?: 1 | 2 }) {
  const secs = d.w.activeMs / 1000;
  const goal = d.w.targetMin ? Math.min(1, secs / (d.w.targetMin * 60)) : null;
  const bpm = d.hr.status === 'connected' && d.hr.bpm ? String(d.hr.bpm) : '– –';
  const items = [
    { icon: 'clock', tone: 'text-cyan', label: 'Time', value: duration(secs), unit: goal !== null ? `of ${d.w.targetMin} min` : '' },
    { icon: 'route', tone: 'text-good', label: 'Distance', value: km(d.w.distanceKm), unit: 'km' },
    { icon: 'flame', tone: 'text-warn', label: 'Calories', value: String(Math.round(d.w.kcal)), unit: 'kcal est.' },
    { icon: 'heart', tone: 'text-bad', label: 'Heart rate', value: bpm, unit: d.hr.status === 'connected' ? 'bpm' : '' },
  ];
  return (
    <div className="neon p-1">
      <div className={`grid ${cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {items.map((x) => (
          <div key={x.label} className="flex items-center gap-2.5 px-3 py-2.5">
            <Icon name={x.icon} size={22} className={`shrink-0 ${x.tone}`} />
            <div className="min-w-0">
              <div className="text-[11.5px] text-mute">{x.label}</div>
              <div className="digits text-[21px] font-bold leading-tight">
                {x.value} {x.unit && <span className="text-[11.5px] font-medium text-mute">{x.unit}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {goal !== null && (
        <div className="mx-3 mb-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]" aria-label={`${Math.round(goal * 100)}% of goal time`}>
          <div className="h-full rounded-full bg-gradient-to-r from-blue via-cyan to-good" style={{ width: `${goal * 100}%`, transition: 'width .5s linear' }} />
        </div>
      )}
      {d.hr.status !== 'connected' && (
        <p className="px-3 pb-2 text-[11.5px] text-dim">
          No heart-rate strap.{' '}
          <button className="min-h-8 font-semibold text-cyan underline underline-offset-4" onClick={() => void connectHr()}>Connect one</button>
        </p>
      )}
    </div>
  );
}

/** Top strip: title, plan name and the Bluetooth indicator. */
export function DashHeader({ d }: { d: ReturnType<typeof useDash> }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10.5px] font-bold uppercase tracking-[0.16em] text-cyan">ProForm Smart Control</div>
        <h1 className="truncate text-[19px] font-bold leading-tight">
          {d.w.status === 'paused' ? 'Paused' : 'Live workout'}
          {d.w.plan && <span className="font-medium text-mute"> · {d.w.plan.name}</span>}
        </h1>
      </div>
      <StatusPill />
    </div>
  );
}

// ---- Style 1: Classic Speedometer --------------------------------------
export function ClassicDashboard() {
  const d = useDash();
  return (
    <section className="dash" aria-label="Workout dashboard">
      <DashHeader d={d} />
      <div className="grid gap-3 landscape:grid-cols-[1.05fr_1fr] landscape:items-start">
        <div className="space-y-3">
          <CoachCard d={d} />
          <PaceBanner d={d} />
          <div className="hidden landscape:block"><StatsPanel d={d} /></div>
        </div>
        <div>
          <Speedometer speed={d.speed} target={d.target} source={d.source} live={d.live} />
        </div>
        <div className="landscape:hidden"><StatsPanel d={d} /></div>
      </div>
    </section>
  );
}
