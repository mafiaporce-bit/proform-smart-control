import { Card } from './ui';
import { PlanChart } from './PlanChart';
import { segEndSec, useWorkout } from '../lib/workout';
import { PaceMatch } from './PaceMatch';
import { duration } from '../lib/format';

/** The guided plan in progress: current block, the speed to set on the console, time left, what comes next. */
/** `pace={false}` hides the pace-match strip (the workout dashboard shows its own). */
export function PlanPanel({ pace = true }: { pace?: boolean } = {}) {
  const w = useWorkout();
  if (!w.plan) return null;
  const sec = w.activeMs / 1000;
  const seg = w.plan.segments[w.segIndex];
  const next = w.plan.segments[w.segIndex + 1];
  const left = Math.max(0, Math.ceil(segEndSec(w.plan, w.segIndex) - sec));
  return (
    <Card hot={!w.planDone}>
      <div className="flex items-center justify-between gap-2">
        <span className="label">{w.plan.name}</span>
        <span className="pill">{w.planDone ? 'Complete' : `${w.segIndex + 1} of ${w.plan.segments.length}`}</span>
      </div>
      {w.planDone ? (
        <p className="mt-2 text-[14px]">Plan complete. Slow down and stop the belt on the console, then tap Finish.</p>
      ) : (
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <div className="text-[13px] text-mute">{seg.label}: set the console to</div>
            <div className="digits text-[34px] font-light leading-none">{seg.kmh.toFixed(1)} <span className="text-[13px] text-mute">km/h</span></div>
          </div>
          <div className="text-right">
            <div className="digits text-[22px] font-semibold leading-none">{duration(left)}</div>
            <div className="text-[12px] text-mute">{next ? `then ${next.kmh.toFixed(1)} km/h` : 'then done'}</div>
          </div>
        </div>
 
      )}
      {pace && !w.planDone && <PaceMatch target={seg.kmh} />}
      <div className="mt-3"><PlanChart plan={w.plan} atSec={sec} /></div>
    </Card>
  );
}
