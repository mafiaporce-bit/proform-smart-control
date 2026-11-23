// Tells the user how to match the plan's target speed, using the real belt speed read from the
// treadmill. The app never changes the belt; this only coaches the number to set on the console.
import { useTreadmillSpeed } from '../ble/telemetry';
import { useCal } from '../ble/speedcal';
import { useBle } from '../ble/useBle';

/** How close counts as "on pace", in km/h. */
const TOL = 0.3;

export function PaceMatch({ target }: { target: number }) {
  const actual = useTreadmillSpeed();
  const cal = useCal();
  const s = useBle();

  // No verified speed reading at all: just remind them to set it (the panel already shows the number).
  if (actual === null) {
    const hint = !cal
      ? 'Set it on the console. Do the one-time speed check in the Bluetooth Lab to get a live match here.'
      : s.status === 'connected'
        ? 'Set it on the console. Waiting for the treadmill to report its speed…'
        : 'Set it on the console. Connect the treadmill for a live match.';
    return <div className="mt-3 rounded-xl border border-line bg-white/[0.03] p-2.5 text-[12.5px] text-mute">{hint}</div>;
  }

  const diff = actual - target;
  const near = Math.abs(diff) <= TOL;
  const label = near ? 'On pace' : diff < 0 ? `Speed up to ${target.toFixed(1)}` : `Ease down to ${target.toFixed(1)}`;
  // A bar centred on the target: the marker sits left when slow, right when fast.
  const span = 2; // km/h shown either side of target
  const posPct = Math.max(0, Math.min(100, 50 + (diff / span) * 50));

  return (
    <div className={`mt-3 rounded-xl border p-3 ${near ? 'border-good/40 bg-good/[0.07]' : 'border-warn/30 bg-warn/[0.06]'}`} role="status">
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 text-[14px] font-semibold ${near ? 'text-good' : 'text-warn'}`}>
          <span className={`dot ${near ? 'dot-live' : 'dot-busy'}`} />
          {near ? 'On pace ✓' : label}
        </span>
        <span className="digits text-[15px]">{actual.toFixed(1)} <span className="text-[12px] text-mute">/ {target.toFixed(1)} km/h</span></span>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-white/10">
        {/* target zone */}
        <div className="absolute inset-y-0 rounded-full bg-good/25" style={{ left: `${50 - (TOL / span) * 50}%`, right: `${50 - (TOL / span) * 50}%` }} />
        {/* your speed marker */}
        <div className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink ${near ? 'bg-good' : 'bg-warn'}`} style={{ left: `${posPct}%` }} />
      </div>
    </div>
  );
}
