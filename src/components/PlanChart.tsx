import type { Plan, SegKind } from '../lib/programs';
import { planTotalSec } from '../lib/programs';

const TONE: Record<SegKind, string> = {
  warm: 'bg-blue/50',
  steady: 'bg-cyan/70',
  fast: 'bg-violet',
  easy: 'bg-cyan/35',
  cool: 'bg-blue/40',
};

/** Speed profile of a plan: bar width is time, bar height is speed. */
export function PlanChart({ plan, atSec }: { plan: Plan; atSec?: number }) {
  const total = planTotalSec(plan);
  const top = Math.max(...plan.segments.map((s) => s.kmh));
  const low = Math.min(...plan.segments.map((s) => s.kmh));
  const pct = atSec === undefined ? null : Math.min(100, (atSec / total) * 100);
  return (
    <div>
      <div className="relative flex h-[72px] items-end gap-[2px]" role="img" aria-label={`Speed plan from ${low.toFixed(1)} to ${top.toFixed(1)} km/h over ${Math.round(total / 60)} minutes`}>
        {plan.segments.map((s, i) => (
          <div
            key={i}
            className={`min-w-[2px] rounded-t-[5px] ${TONE[s.kind]}`}
            style={{ flex: `${s.sec} 0 0`, height: `${25 + (top > 0 ? (s.kmh / top) * 75 : 0)}%` }}
          />
        ))}
        {pct !== null && (
          <div className="pointer-events-none absolute inset-y-[-4px] w-[2px] rounded bg-white shadow-[0_0_8px_rgba(255,255,255,.8)]" style={{ left: `${pct}%` }} />
        )}
      </div>
      <div className="digits mt-1.5 flex justify-between text-[11px] text-dim">
        <span>0:00</span>
        <span>{low.toFixed(1)} to {top.toFixed(1)} km/h</span>
        <span>{Math.round(total / 60)} min</span>
      </div>
    </div>
  );
}
