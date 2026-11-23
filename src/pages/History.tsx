import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/icons';
import { Card, PageHeader, Stat, go } from '../components/ui';
import { deleteWorkout, listWorkouts, onDbChange, type Workout } from '../db/db';
import { dayKey, download, duration, fileStamp, km, kmh, niceDate, niceTime } from '../lib/format';
import { DAY, between, streaks, totals, weekStart } from '../lib/stats';

type Range = 'today' | 'week' | 'month' | 'all';
type ChartMode = 'days' | 'weeks' | 'months';

export function workoutsCsv(all: Workout[]) {
  const rows = ['date,start_time,duration_min,distance_km,avg_kmh,max_kmh,incline_pct,est_kcal,program,virtual_environment,avg_hr,max_hr,speed_source'];
  for (const w of [...all].reverse()) {
    const d = new Date(w.startedAt);
    rows.push(
      [
        dayKey(w.startedAt),
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        (w.durationSec / 60).toFixed(1),
        w.distanceKm.toFixed(3),
        w.avgKmh.toFixed(1),
        w.maxKmh.toFixed(1),
        w.inclinePct.toFixed(1),
        w.kcal,
        `"${(w.program ?? '').replace(/"/g, '""')}"`,
        `"${(w.virtual ?? '').replace(/"/g, '""')}"`,
        w.avgHr ?? '',
        w.maxHr ?? '',
        'entered by user',
      ].join(','),
    );
  }
  return rows.join('\n');
}

interface Bar {
  key: string;
  label: string;
  km: number;
  min: number;
  now: boolean;
}

export function chartBars(all: Workout[], mode: ChartMode, now = Date.now()): Bar[] {
  const sum = (from: number, to: number) => {
    const t = totals(between(all, from, to));
    return { km: t.km, min: Math.round(t.sec / 60) };
  };
  if (mode === 'days') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() - (6 - i));
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      return { key: String(d.getTime()), label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), ...sum(d.getTime(), next.getTime()), now: i === 6 };
    });
  }
  if (mode === 'weeks') {
    const ws = weekStart(now);
    return Array.from({ length: 8 }, (_, i) => {
      const d = new Date(ws);
      d.setDate(d.getDate() - 7 * (7 - i));
      const next = new Date(d);
      next.setDate(next.getDate() + 7);
      return { key: String(d.getTime()), label: `${d.getDate()}/${d.getMonth() + 1}`, ...sum(d.getTime(), next.getTime()), now: i === 7 };
    });
  }
  const first = new Date(now);
  first.setHours(0, 0, 0, 0);
  first.setDate(1);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(first.getFullYear(), first.getMonth() - (5 - i), 1);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { key: String(d.getTime()), label: d.toLocaleDateString(undefined, { month: 'short' }), ...sum(d.getTime(), next.getTime()), now: i === 5 };
  });
}

function Chart({ all }: { all: Workout[] }) {
  const [mode, setMode] = useState<ChartMode>('days');
  const [picked, setPicked] = useState<string | null>(null);
  const bars = useMemo(() => chartBars(all, mode), [all, mode]);
  const max = Math.max(0.001, ...bars.map((b) => b.km));
  const sel = bars.find((b) => b.key === picked) ?? null;
  const title = mode === 'days' ? 'Last 7 days' : mode === 'weeks' ? 'Last 8 weeks' : 'Last 6 months';
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <div className="label">{title}</div>
        <div className="flex gap-1" role="tablist" aria-label="Chart period">
          {(['days', 'weeks', 'months'] as ChartMode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => { setMode(m); setPicked(null); }}
              className={`pill min-h-9 ${mode === m ? '!border-cyan !text-cyan' : ''}`}
            >
              {m === 'days' ? 'Days' : m === 'weeks' ? 'Weeks' : 'Months'}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 h-5 text-[12.5px] text-mute">
        {sel ? <span className="digits">{sel.label}: {sel.km.toFixed(2)} km · {sel.min} min</span> : 'Distance in km. Tap a bar for details.'}
      </div>
      <div className="mt-2 flex h-[128px] items-end gap-2">
        {bars.map((b) => (
          <button
            key={b.key}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
            onClick={() => setPicked(picked === b.key ? null : b.key)}
            aria-label={`${b.label}: ${b.km.toFixed(2)} km, ${b.min} minutes`}
          >
            <span className="digits text-[10.5px] text-mute">{b.km > 0 ? b.km.toFixed(b.km < 10 ? 1 : 0) : ''}</span>
            <span
              className={`w-full rounded-t-lg ${b.km > 0 ? (picked === b.key ? 'bg-white' : 'bg-gradient-to-t from-blue to-cyan') : 'bg-white/[0.07]'}`}
              style={{ height: b.km > 0 ? `${Math.max(5, (b.km / max) * 74)}%` : '3px' }}
            />
            <span className={`text-[10.5px] font-semibold ${b.now ? 'text-cyan' : 'text-dim'}`}>{b.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function SpeedLine({ w }: { w: Workout }) {
  if (w.samples.length < 2) return <p className="text-[12.5px] text-mute">Speed stayed at {w.samples[0]?.kmh.toFixed(1) ?? w.avgKmh.toFixed(1)} km/h for the whole workout.</p>;
  const top = Math.max(...w.samples.map((s) => s.kmh));
  const W = 300;
  const H = 56;
  const x = (t: number) => (t / Math.max(1, w.durationSec)) * W;
  const y = (v: number) => H - 4 - (v / top) * (H - 10);
  let d = '';
  w.samples.forEach((s, i) => {
    d += i === 0 ? `M${x(s.t).toFixed(1)} ${y(s.kmh).toFixed(1)}` : ` H${x(s.t).toFixed(1)} V${y(s.kmh).toFixed(1)}`;
  });
  d += ` H${W}`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" preserveAspectRatio="none" role="img" aria-label={`Speed over time, up to ${top.toFixed(1)} km/h`}>
        <path d={d} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="digits flex justify-between text-[11px] text-dim"><span>0:00</span><span>speed entered, peak {top.toFixed(1)} km/h</span><span>{duration(w.durationSec)}</span></div>
    </div>
  );
}

export function History() {
  const [all, setAll] = useState<Workout[] | null>(null);
  const [range, setRange] = useState<Range>('week');
  const [open, setOpen] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  useEffect(() => {
    const load = () => listWorkouts().then(setAll).catch(() => setAll([]));
    load();
    return onDbChange(load);
  }, []);

  const list = all ?? [];
  const shown = useMemo(() => {
    const now = Date.now();
    if (range === 'today') return list.filter((w) => dayKey(w.startedAt) === dayKey(now));
    if (range === 'week') return list.filter((w) => now - w.startedAt < 7 * DAY);
    if (range === 'month') return list.filter((w) => now - w.startedAt < 30 * DAY);
    return list;
  }, [list, range]);

  const total = totals(shown);
  const streak = useMemo(() => streaks(list), [list]);

  return (
    <>
      <PageHeader
        title="History"
        sub="Stored on this phone only"
        right={
          <button className="btn btn-sm" disabled={!list.length} onClick={() => download(`proform-workouts-${fileStamp()}.csv`, workoutsCsv(list), 'text/csv')}>
            <Icon name="download" size={18} /> CSV
          </button>
        }
      />

      <div className="glass flex gap-1 !rounded-2xl p-1" role="tablist" aria-label="Period">
        {(['today', 'week', 'month', 'all'] as Range[]).map((r) => (
          <button
            key={r}
            role="tab"
            aria-selected={range === r}
            onClick={() => setRange(r)}
            className={`min-h-11 flex-1 rounded-xl text-[13px] font-semibold transition-colors ${range === r ? 'bg-white/10 text-text' : 'text-mute'}`}
          >
            {r === 'today' ? 'Today' : r === 'week' ? '7 days' : r === 'month' ? '30 days' : 'All'}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        <Stat icon="clock" label="Time" value={total.sec >= 3600 ? (total.sec / 3600).toFixed(1) : String(Math.round(total.sec / 60))} unit={total.sec >= 3600 ? 'h' : 'min'} />
        <Stat icon="route" label="Distance" value={km(total.km, total.km < 10 ? 2 : 1)} unit="km" />
        <Stat icon="flame" label="kcal" value={String(Math.round(total.kcal))} unit="est." tone="text-warn" />
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2.5">
        <Stat icon="spark" label="Streak" value={String(streak.current)} unit={streak.current === 1 ? 'day' : 'days'} tone="text-violet" />
        <Stat icon="spark" label="Best" value={String(streak.best)} unit={streak.best === 1 ? 'day' : 'days'} tone="text-violet" />
        <Stat icon="wave" label="Workouts" value={String(total.count)} tone="text-good" />
      </div>

      <div className="mt-3">
        <Chart all={list} />
      </div>

      <div className="mt-5 flex items-baseline justify-between px-1">
        <h2 className="label">Workouts</h2>
        <span className="text-[12px] text-mute">{shown.length} shown</span>
      </div>

      {all !== null && shown.length === 0 && (
        <Card className="mt-2 text-center">
          <p className="font-semibold">No workouts here yet</p>
          <p className="mt-1 text-[13px] text-mute">Finish a workout and it will show up in this list.</p>
          <button className="btn btn-primary mt-3" onClick={() => go('workout')}><Icon name="play" size={18} /> Start a workout</button>
        </Card>
      )}

      <ul className="mt-2 space-y-2.5">
        {shown.map((w) => (
          <li key={w.id} className="glass p-3.5">
            <div className="flex items-center gap-1">
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(open === w.id ? null : (w.id ?? null))} aria-expanded={open === w.id}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan/10 text-cyan"><Icon name="wave" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{niceDate(w.startedAt)} <span className="font-normal text-mute">· {niceTime(w.startedAt)}</span></span>
                  <span className="digits block text-[13px] text-mute">
                    {duration(w.durationSec)} · {km(w.distanceKm)} km · {w.kcal} kcal
                  </span>
                  {(w.program || w.virtual) && (
                    <span className="block truncate text-[12.5px] text-violet">
                      {[w.virtual ? `Virtual Running · ${w.virtual}` : '', w.program ?? ''].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              </button>
              <button className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-dim" aria-label="Delete workout" onClick={() => setPendingDelete(w.id ?? null)}>
                <Icon name="trash" size={19} />
              </button>
            </div>
            {open === w.id && (
              <div className="mt-3 border-t border-line pt-3">
                <SpeedLine w={w} />
                <dl className="digits mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                  <div className="flex justify-between"><dt className="text-mute">Avg speed</dt><dd>{kmh(w.avgKmh)} km/h</dd></div>
                  <div className="flex justify-between"><dt className="text-mute">Top speed</dt><dd>{kmh(w.maxKmh)} km/h</dd></div>
                  <div className="flex justify-between"><dt className="text-mute">Incline</dt><dd>{w.inclinePct.toFixed(1)}% manual</dd></div>
                  <div className="flex justify-between"><dt className="text-mute">Heart rate</dt><dd>{w.avgHr ? `${w.avgHr} avg, ${w.maxHr} max` : 'not recorded'}</dd></div>
                </dl>
              </div>
            )}
            {pendingDelete === w.id && (
              <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                <span className="flex-1 text-[13px] text-mute">Delete this workout for good?</span>
                <button className="btn btn-sm" onClick={() => setPendingDelete(null)}>Keep</button>
                <button className="btn btn-sm btn-danger" onClick={() => { setPendingDelete(null); if (w.id != null) void deleteWorkout(w.id); }}>Delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 px-1 text-[12px] text-dim">
        Distance and calories are worked out from the speed you entered, the plan you followed or the virtual pace you set. They are not measured by the treadmill.
      </p>
    </>
  );
}
