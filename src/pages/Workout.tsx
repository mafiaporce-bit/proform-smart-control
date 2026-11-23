import { useState } from 'react';
import { Icon } from '../components/icons';
import { Card, PageHeader, SafetyNote, Stat, StatusPill, go } from '../components/ui';
import {
  SPEED_MAX,
  SPEED_MIN,
  discardWorkout,
  finishWorkout,
  pauseWorkout,
  resumeWorkout,
  setLoggedIncline,
  setLoggedSpeed,
  startWorkout,
  useWorkout,
} from '../lib/workout';
import { useSettings } from '../lib/settings';
import { duration, km, kmh } from '../lib/format';
import { PlanPanel } from '../components/PlanPanel';
import { connectHr, disconnectHr, useHr } from '../lib/hr';
import { useBle } from '../ble/useBle';
import type { Workout } from '../db/db';

const TARGETS = [null, 15, 20, 30, 45, 60];

function Ring({ pct }: { pct: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
      <defs>
        <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82ff" />
          <stop offset=".6" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#8f7bff" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r={r} fill="none" strokeWidth="5" className="ring-track" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="url(#ring)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, pct)))}
        style={{ transition: 'stroke-dashoffset 0.5s linear' }}
      />
    </svg>
  );
}

function SpeedLogger() {
  const w = useWorkout();
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <span className="label">Speed on your console</span>
        <span className="pill">Entered by you</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button className="btn !min-h-[60px] w-[72px] !rounded-[18px]" onClick={() => setLoggedSpeed(w.speedKmh - 0.1)} aria-label="Lower logged speed by 0.1">
          <Icon name="minus" size={26} />
        </button>
        <div className="flex-1 text-center">
          <span className="digits text-[52px] font-light leading-none">{kmh(w.speedKmh)}</span>
          <span className="ml-1 text-[13px] text-mute">km/h</span>
        </div>
        <button className="btn !min-h-[60px] w-[72px] !rounded-[18px]" onClick={() => setLoggedSpeed(w.speedKmh + 0.1)} aria-label="Raise logged speed by 0.1">
          <Icon name="plus" size={26} />
        </button>
      </div>
      <input
        type="range"
        className="range mt-1"
        min={SPEED_MIN}
        max={SPEED_MAX}
        step={0.1}
        value={w.speedKmh}
        onChange={(e) => setLoggedSpeed(Number(e.target.value))}
        aria-label="Logged speed"
      />
      <p className="text-[12.5px] text-mute">
        {w.plan && w.status !== 'idle'
          ? 'The plan sets this at each change. If your console shows a different speed, correct it here. It does not change the belt.'
          : 'Match this to the speed shown on the treadmill. It only feeds the distance and calorie maths. It does not change the belt.'}
      </p>
    </Card>
  );
}

function HrCard() {
  const hr = useHr();
  const ble = useBle();
  const live = hr.status === 'connected';
  return (
    <Card>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-bad/10 text-bad"><Icon name="heart" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">Heart-rate strap</div>
          <div className="truncate text-[12.5px] text-mute">
            {live
              ? `${hr.name}: ${hr.bpm ? `${hr.bpm} bpm` : 'waiting for a reading'}`
              : hr.status === 'connecting' || hr.status === 'choosing'
                ? 'Connecting…'
                : hr.status === 'error'
                  ? `Could not connect: ${hr.error}`
                  : hr.status === 'disconnected'
                    ? 'Disconnected'
                    : 'Optional. Any Bluetooth chest strap or band.'}
          </div>
        </div>
        {live ? (
          <button className="btn btn-sm" onClick={disconnectHr}>Remove</button>
        ) : (
          <button className="btn btn-sm" disabled={ble.support !== 'ok' || hr.status === 'connecting' || hr.status === 'choosing'} onClick={() => void connectHr()}>Connect</button>
        )}
      </div>
    </Card>
  );
}

function Summary({ w, onClose }: { w: Workout; onClose: () => void }) {
  return (
    <Card hot className="text-center">
      <div className="label text-good">Workout saved</div>
      <div className="digits mt-2 text-[44px] font-light leading-none">{km(w.distanceKm)} <span className="text-[16px] text-mute">km</span></div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
        <div><div className="digits text-[18px] font-semibold">{duration(w.durationSec)}</div><div className="text-mute">time</div></div>
        <div><div className="digits text-[18px] font-semibold">{w.kcal}</div><div className="text-mute">est. kcal</div></div>
        <div><div className="digits text-[18px] font-semibold">{kmh(w.avgKmh)}</div><div className="text-mute">avg km/h</div></div>
      </div>
      {(w.program || w.avgHr) && (
        <p className="mt-2 text-[13px] text-mute">{[w.program, w.avgHr ? `avg ${w.avgHr} bpm, max ${w.maxHr} bpm` : ''].filter(Boolean).join(' · ')}</p>
      )}
      <div className="mt-4 flex gap-2">
        <button className="btn flex-1" onClick={onClose}>Done</button>
        <button className="btn btn-primary flex-1" onClick={() => go('history')}>See history</button>
      </div>
    </Card>
  );
}

export function WorkoutPage() {
  const w = useWorkout();
  const settings = useSettings();
  const hr = useHr();
  const [target, setTarget] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<'finish' | 'discard' | null>(null);
  const [saved, setSaved] = useState<Workout | null>(null);
  const [tooShort, setTooShort] = useState(false);

  const secs = w.activeMs / 1000;
  const pct = w.targetMin ? secs / (w.targetMin * 60) : 0;

  if (w.status === 'idle') {
    return (
      <>
        <PageHeader title="Workout" sub="Timer, distance and estimated calories" right={<StatusPill />} />
        {saved && <div className="mb-4"><Summary w={saved} onClose={() => setSaved(null)} /></div>}
        {tooShort && (
          <p className="mb-4 rounded-2xl border border-line bg-white/[0.04] p-3 text-[13px] text-mute">That one was under 10 seconds, so it was not saved.</p>
        )}
        <SafetyNote compact />
        <div className="mt-4 space-y-4">
          <SpeedLogger />
          <Card>
            <div className="label">Goal time</div>
            <div className="mt-2.5 grid grid-cols-6 gap-2">
              {TARGETS.map((t) => (
                <button
                  key={String(t)}
                  className={`btn btn-sm !px-0 ${target === t ? '!border-cyan !bg-cyan/15 text-cyan' : ''}`}
                  aria-pressed={target === t}
                  onClick={() => setTarget(t)}
                >
                  {t === null ? 'Free' : t}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Incline: Manual</div>
                <div className="text-[12.5px] text-mute">Set by hand on the deck. Enter it for the calorie estimate.</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn btn-sm !px-0 w-11" onClick={() => setLoggedIncline(w.inclinePct - 0.5)} aria-label="Lower incline"><Icon name="minus" size={18} /></button>
                <span className="digits w-12 text-center font-semibold">{w.inclinePct.toFixed(1)}%</span>
                <button className="btn btn-sm !px-0 w-11" onClick={() => setLoggedIncline(w.inclinePct + 0.5)} aria-label="Raise incline"><Icon name="plus" size={18} /></button>
              </div>
            </div>
          </Card>
          <HrCard />
          <button
            className="btn btn-primary !min-h-[64px] w-full !rounded-[22px] text-[17px]"
            onClick={() => {
              setSaved(null);
              setTooShort(false);
              startWorkout({ targetMin: target });
            }}
          >
            <Icon name="play" size={20} /> Start workout timer
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <button className="btn" onClick={() => go('programs')}><Icon name="list" size={18} /> Programs</button>
            <button className="btn" onClick={() => go('virtual')}><Icon name="walk" size={18} /> 3D Park</button>
          </div>
          <p className="px-1 text-center text-[12.5px] text-mute">
            Start the belt on the treadmill console yourself. This button starts the app's timer only. Calories use your weight ({settings.weightKg} kg, change it in Settings).
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={w.status === 'paused' ? 'Paused' : 'Live workout'} sub={w.plan ? 'Following a guided plan' : 'Speed entered by you'} right={<StatusPill />} />

      <div className="relative mx-auto aspect-square w-[78%] max-w-[300px]">
        <Ring pct={w.targetMin ? pct : 1} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="label">{w.targetMin ? `of ${w.targetMin} min` : 'Time'}</div>
          <div className={`digits mt-1 text-[58px] font-extralight leading-none ${w.status === 'paused' ? 'text-warn' : ''}`}>{duration(secs)}</div>
          <div className="mt-2 text-[13px] text-mute">
            {w.targetMin ? (pct >= 1 ? 'Goal reached' : `${Math.round(pct * 100)}% done`) : w.status === 'paused' ? 'Timer on hold' : 'Free run'}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <Stat icon="route" label="km" value={km(w.distanceKm)} />
        <Stat icon="flame" label="kcal" value={String(Math.round(w.kcal))} unit="est." tone="text-warn" />
        <Stat icon="heart" label="bpm" value={hr.status === 'connected' && hr.bpm ? String(hr.bpm) : '– –'} tone="text-bad" />
      </div>
      {hr.status !== 'connected' && (
        <p className="mt-1.5 px-1 text-[12px] text-dim">
          No heart-rate strap connected.{' '}
          <button className="min-h-9 font-semibold text-cyan underline underline-offset-4" onClick={() => void connectHr()}>Connect one</button>
        </p>
      )}

      <div className="mt-4 space-y-4">
        <button className="btn w-full" onClick={() => go('virtual')}>
          <Icon name="walk" size={18} /> {w.virtual ? `Back to ${w.virtual}` : 'Watch in the 3D park'}
        </button>
        <PlanPanel />
        <SpeedLogger />

        <div className="grid grid-cols-2 gap-2.5">
          {w.status === 'running' ? (
            <button className="btn !min-h-[60px]" onClick={pauseWorkout}><Icon name="pause" size={20} /> Pause timer</button>
          ) : (
            <button className="btn btn-primary !min-h-[60px]" onClick={resumeWorkout}><Icon name="play" size={18} /> Resume</button>
          )}
          <button className="btn btn-violet !min-h-[60px]" onClick={() => setConfirm('finish')}><Icon name="stop" size={16} /> Finish</button>
        </div>

        {confirm && (
          <Card className="!border-violet/40">
            <div className="font-semibold">{confirm === 'finish' ? 'Finish and save this workout?' : 'Throw this workout away?'}</div>
            <p className="mt-1 text-[13px] text-mute">
              {confirm === 'finish' ? 'Remember to stop the belt on the treadmill console.' : 'It will not be saved to your history.'}
            </p>
            <div className="mt-3 flex gap-2">
              <button className="btn flex-1" onClick={() => setConfirm(null)}>Keep going</button>
              {confirm === 'finish' ? (
                <button
                  className="btn btn-primary flex-1"
                  onClick={async () => {
                    setConfirm(null);
                    const r = await finishWorkout();
                    setSaved(r);
                    setTooShort(r === null);
                  }}
                >
                  Save
                </button>
              ) : (
                <button className="btn btn-danger flex-1" onClick={() => { setConfirm(null); discardWorkout(); }}>Discard</button>
              )}
            </div>
          </Card>
        )}

        <Card>
          <div className="flex items-center gap-3">
            <button className="btn btn-danger flex-1" disabled>
              <Icon name="lock" size={16} /> Stop treadmill
            </button>
            <p className="flex-1 text-[12.5px] text-mute">Not available. The app cannot stop the belt yet. Use the console, or pull the safety key.</p>
          </div>
        </Card>

        <SafetyNote compact />

        {!confirm && (
          <button className="mx-auto block min-h-11 px-4 text-[13px] text-dim underline underline-offset-4" onClick={() => setConfirm('discard')}>
            Discard workout
          </button>
        )}
      </div>
    </>
  );
}
