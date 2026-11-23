import { useState } from 'react';
import { Icon } from '../components/icons';
import { Card, PageHeader, SafetyNote, go } from '../components/ui';
import { PlanChart } from '../components/PlanChart';
import {
  LEVELS,
  PROGRAMS,
  buildCustomPlan,
  buildPlan,
  loadCustom,
  planTotalSec,
  saveCustom,
  type CustomBlock,
  type Level,
  type Plan,
  type PlanSegment,
} from '../lib/programs';
import { useSettings } from '../lib/settings';
import { startWorkout, useWorkout } from '../lib/workout';

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Collapses a repeating pair of segments ("6 × Fast 1:00, Recover 2:00") for a shorter list. */
function grouped(segs: PlanSegment[]) {
  const out: Array<{ times: number; items: PlanSegment[] }> = [];
  let i = 0;
  const same = (a?: PlanSegment, b?: PlanSegment) => !!a && !!b && a.kind === b.kind && a.sec === b.sec && a.kmh === b.kmh;
  while (i < segs.length) {
    let times = 1;
    while (same(segs[i], segs[i + 2 * times]) && same(segs[i + 1], segs[i + 1 + 2 * times])) times++;
    if (times > 1) {
      out.push({ times, items: [segs[i], segs[i + 1]] });
      i += 2 * times;
    } else {
      out.push({ times: 1, items: [segs[i]] });
      i++;
    }
  }
  return out;
}

function PlanView({ plan, onStart, busy }: { plan: Plan; onStart: () => void; busy: boolean }) {
  return (
    <>
      <Card>
        <PlanChart plan={plan} />
        <ul className="mt-3 divide-y divide-line text-[13.5px]">
          {grouped(plan.segments).map((g, i) => (
            <li key={i} className="flex items-center gap-3 py-2">
              <span className="w-9 shrink-0 text-center text-[12px] font-bold text-violet">{g.times > 1 ? `${g.times}×` : ''}</span>
              <span className="flex-1">
                {g.items.map((s, j) => (
                  <span key={j} className="flex justify-between gap-2">
                    <span>{s.label}</span>
                    <span className="digits text-mute">{mmss(s.sec)} at <span className="text-text">{s.kmh.toFixed(1)}</span> km/h</span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-3 px-1 text-[12.5px] text-mute">
        A voice cue tells you when to change speed. You change it on the treadmill console. The app does not move the belt, and it counts distance as if you matched each speed.
      </p>
      <button className="btn btn-primary mt-3 !min-h-[60px] w-full !rounded-[20px] text-[16px]" disabled={busy} onClick={onStart}>
        <Icon name="play" size={18} /> Start {Math.round(planTotalSec(plan) / 60)}-minute plan
      </button>
      {busy && <p className="mt-2 text-center text-[12.5px] text-warn">A workout is already in progress. Finish it first.</p>}
    </>
  );
}

function CustomBuilder({ maxKmh, busy }: { maxKmh: number; busy: boolean }) {
  const [blocks, setBlocks] = useState<CustomBlock[]>(loadCustom);
  const update = (next: CustomBlock[]) => {
    setBlocks(next);
    saveCustom(next);
  };
  const edit = (i: number, patch: Partial<CustomBlock>) => update(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 10) / 10));
  const plan = buildCustomPlan(blocks, maxKmh);
  return (
    <>
      <Card>
        <div className="label">Your blocks</div>
        <ul className="mt-2 space-y-2">
          {blocks.map((b, i) => (
            <li key={i} className="rounded-2xl border border-line bg-white/[0.03] p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">Block {i + 1}</span>
                <button className="grid h-9 w-9 place-items-center rounded-lg text-dim disabled:opacity-30" disabled={blocks.length <= 1} aria-label={`Remove block ${i + 1}`} onClick={() => update(blocks.filter((_, j) => j !== i))}>
                  <Icon name="trash" size={17} />
                </button>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {([
                  ['min', 'min', 1, 1, 90],
                  ['kmh', 'km/h', 0.5, 1, maxKmh],
                ] as const).map(([field, unit, step, lo, hi]) => (
                  <div key={field} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-1">
                    <button className="grid h-11 w-10 place-items-center" aria-label={`Less ${unit}`} onClick={() => edit(i, { [field]: clamp(b[field] - step, lo, hi) })}><Icon name="minus" size={18} /></button>
                    <span className="digits text-center"><span className="font-semibold">{field === 'min' ? b.min : Math.min(b.kmh, hi).toFixed(1)}</span> <span className="text-[12px] text-mute">{unit}</span></span>
                    <button className="grid h-11 w-10 place-items-center" aria-label={`More ${unit}`} onClick={() => edit(i, { [field]: clamp(b[field] + step, lo, hi) })}><Icon name="plus" size={18} /></button>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <button className="btn btn-sm mt-2 w-full" disabled={blocks.length >= 20} onClick={() => update([...blocks, { min: 5, kmh: Math.min(5, maxKmh) }])}>
          <Icon name="plus" size={16} /> Add block
        </button>
      </Card>
      <div className="mt-4">
        <PlanView plan={plan} busy={busy} onStart={() => { startWorkout({ plan }); go('workout'); }} />
      </div>
    </>
  );
}

export function Programs() {
  const settings = useSettings();
  const workout = useWorkout();
  const [open, setOpen] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>('standard');
  const busy = workout.status !== 'idle';
  const max = settings.planMaxKmh;

  if (open) {
    const def = PROGRAMS.find((p) => p.id === open);
    return (
      <>
        <header className="flex items-center gap-3 pb-4 pt-1">
          <button className="btn btn-sm w-11 shrink-0 !px-0" onClick={() => setOpen(null)} aria-label="Back to programs"><Icon name="back" /></button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-bold leading-tight tracking-tight">{def ? def.name : 'Custom Workout'}</h1>
            <p className="text-[13px] text-mute">{def ? def.blurb : 'Build your own blocks. Saved on this phone.'}</p>
          </div>
        </header>
        {def ? (
          <>
            <div className="glass mb-4 flex gap-1 !rounded-2xl p-1" role="tablist" aria-label="Level">
              {LEVELS.map((l) => (
                <button key={l.id} role="tab" aria-selected={level === l.id} onClick={() => setLevel(l.id)} className={`min-h-11 flex-1 rounded-xl text-[13.5px] font-semibold ${level === l.id ? 'bg-white/10' : 'text-mute'}`}>
                  {l.label}
                </button>
              ))}
            </div>
            <PlanView plan={buildPlan(def, level, max)} busy={busy} onStart={() => { startWorkout({ plan: buildPlan(def, level, max) }); go('workout'); }} />
          </>
        ) : (
          <CustomBuilder maxKmh={max} busy={busy} />
        )}
        <div className="mt-4"><SafetyNote compact /></div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Training Programs" sub="Guided speed plans with voice cues" back="more" />
      <ul className="space-y-2.5">
        {PROGRAMS.map((p) => {
          const plan = buildPlan(p, 'standard', max);
          return (
            <li key={p.id}>
              <button className="glass w-full p-4 text-left active:scale-[0.98]" onClick={() => setOpen(p.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-[13px] text-mute">{p.blurb}</div>
                  </div>
                  <span className="pill shrink-0">{Math.round(planTotalSec(plan) / 60)} min</span>
                </div>
                <div className="mt-3"><PlanChart plan={plan} /></div>
              </button>
            </li>
          );
        })}
        <li>
          <button className="glass flex w-full items-center gap-3 p-4 text-left active:scale-[0.98]" onClick={() => setOpen('custom')}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet/15 text-violet"><Icon name="plus" /></span>
            <span className="flex-1">
              <span className="block font-semibold">Custom Workout</span>
              <span className="block text-[13px] text-mute">Build your own blocks of time and speed</span>
            </span>
            <Icon name="chevron" size={18} className="text-dim" />
          </button>
        </li>
      </ul>
      <p className="mt-4 px-1 text-[12.5px] text-mute">
        No plan suggests more than {max.toFixed(1)} km/h. Change that cap in Settings. Plans never change the belt speed for you.
      </p>
    </>
  );
}
