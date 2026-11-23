import { useEffect, useState } from 'react';
import { Icon, Logo } from '../components/icons';
import { Card, ConnectButtons, Footer, StatusPill, SupportWarning, go } from '../components/ui';
import { useBle } from '../ble/useBle';
import { useWorkout } from '../lib/workout';
import { listWorkouts, onDbChange, type Workout } from '../db/db';
import { dayKey, duration, durationWords, km } from '../lib/format';
import { coachView, useProfile } from '../lib/coach';


const tiles = [
  { route: 'remote', icon: 'remote', title: 'Treadmill Remote', sub: 'Locked until verified', tone: 'text-cyan' },
  { route: 'coach', icon: 'spark', title: 'AI Coach', sub: 'Plan and weekly goal', tone: 'text-violet' },
  { route: 'programs', icon: 'list', title: 'Training Programs', sub: 'Guided speed plans', tone: 'text-blue' },
  { route: 'history', icon: 'chart', title: 'Workout History', sub: 'Stats and CSV export', tone: 'text-good' },
  { route: 'diagnostics', icon: 'flask', title: 'Bluetooth Lab', sub: 'Packets and logs', tone: 'text-cyan' },
  { route: 'settings', icon: 'gear', title: 'Settings', sub: 'Voice, weight, install', tone: 'text-mute' },
];

function Treadmill({ moving }: { moving: boolean }) {
  return (
    <svg viewBox="0 0 220 120" className="h-[92px] w-auto" aria-hidden="true">
      <defs>
        <linearGradient id="tm" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3b82ff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path d="M150 92 176 22" stroke="#33407a" strokeWidth="7" strokeLinecap="round" />
      <rect x="158" y="10" width="46" height="20" rx="7" fill="#101a40" stroke="url(#tm)" strokeWidth="2" />
      <rect x="166" y="16" width="18" height="8" rx="2" fill="#22d3ee" opacity=".85" />
      <path d="M176 44h-34" stroke="#33407a" strokeWidth="6" strokeLinecap="round" />
      <rect x="14" y="86" width="176" height="16" rx="8" fill="#0d1535" stroke="#33407a" strokeWidth="2" />
      <path
        d="M24 94h156"
        stroke="url(#tm)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="20 12"
        style={moving ? { animation: 'belt 0.9s linear infinite' } : undefined}
      />
      <circle cx="26" cy="108" r="5" fill="#33407a" />
      <circle cx="178" cy="108" r="5" fill="#33407a" />
    </svg>
  );
}

export function Home() {
  const s = useBle();
  const w = useWorkout();
  const [today, setToday] = useState({ sec: 0, km: 0, kcal: 0, count: 0 });
  const [all, setAll] = useState<Workout[]>([]);
  const profile = useProfile();
  const coach = profile ? coachView(profile, all) : null;

  useEffect(() => {
    const load = () =>
      listWorkouts()
        .then((all: Workout[]) => {
          setAll(all);
          const key = dayKey(Date.now());
          const t = all.filter((x) => dayKey(x.startedAt) === key);
          setToday({
            sec: t.reduce((a, x) => a + x.durationSec, 0),
            km: t.reduce((a, x) => a + x.distanceKm, 0),
            kcal: t.reduce((a, x) => a + x.kcal, 0),
            count: t.length,
          });
        })
        .catch(() => {});
    load();
    return onDbChange(load);
  }, []);

  const active = w.status !== 'idle';

  return (
    <>
      <header className="flex items-center gap-3 pb-4 pt-1">
        <Logo size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-[19px] font-bold leading-tight tracking-tight">
            ProForm <span className="bg-gradient-to-r from-blue to-cyan bg-clip-text text-transparent">Smart Control</span>
          </div>
          <div className="text-[12.5px] text-mute">Your 105 CST, on your phone</div>
        </div>
      </header>

      <Card hot={s.status === 'connected'} className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-cyan/20 blur-3xl" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="label">Treadmill</div>
            <div className="mt-1 text-[20px] font-bold tracking-tight">ProForm 105 CST</div>
            <div className="mt-2">
              <StatusPill />
            </div>
          </div>
          <Treadmill moving={w.status === 'running'} />
        </div>
        <p className="mt-3 text-[13px] text-mute">
          {s.status === 'connected'
            ? `Linked to "${s.deviceName}". Listening only: ${s.sessionPackets} packet${s.sessionPackets === 1 ? '' : 's'} this session.`
            : s.lastDisconnect && s.status === 'disconnected'
              ? s.lastDisconnect
              : 'Bluetooth name I_TL. Connecting here only listens. It cannot move the belt.'}
        </p>
        <div className="mt-3 space-y-3">
          <SupportWarning />
          <ConnectButtons />
        </div>
      </Card>

      <button className="btn btn-primary mt-4 !min-h-[64px] w-full !justify-between !rounded-[22px] !px-5 text-left" onClick={() => go('workout')}>
        <span>
          <span className="block text-[17px] font-bold">{active ? 'Back to workout' : 'Quick workout'}</span>
          <span className="block text-[12.5px] font-medium opacity-75">
            {active ? `${duration(w.activeMs / 1000)} · ${km(w.distanceKm)} km${w.status === 'paused' ? ' · paused' : ''}` : 'Timer, distance and calories'}
          </span>
        </span>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[#03101f]/15">
          <Icon name={active ? 'chevron' : 'play'} size={20} />
        </span>
      </button>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {[
          { label: 'Today', value: today.count ? durationWords(today.sec) : '0 min' },
          { label: 'Distance', value: `${km(today.km)} km` },
          { label: 'Est. kcal', value: String(Math.round(today.kcal)) },
        ].map((x) => (
          <div key={x.label} className="glass px-3 py-3 text-center">
            <div className="label !text-[10px]">{x.label}</div>
            <div className="digits mt-1 text-[16px] font-semibold">{x.value}</div>
          </div>
        ))}
      </div>

      <button
        className="relative mt-4 block w-full overflow-hidden rounded-[22px] border border-cyan/25 text-left active:scale-[0.98] transition-transform"
        onClick={() => go('workout')}
        aria-label="Open the workout dashboard"
      >
        <span className="block h-[130px] w-full bg-[radial-gradient(100%_90%_at_90%_0%,rgba(34,211,238,.28),transparent_60%),linear-gradient(135deg,#0b1535,#050a1c)]" />
        <svg viewBox="0 0 120 120" className="absolute right-3 top-3 h-[104px] w-[104px]" aria-hidden="true">
          <path d="M23 92 A48 48 0 1 1 97 92" fill="none" stroke="rgba(233,238,255,.12)" strokeWidth="8" strokeLinecap="round" />
          <path d="M23 92 A48 48 0 0 1 80 18" fill="none" stroke="#22d3ee" strokeWidth="8" strokeLinecap="round" />
          <path d="M58 60 L83 30 L62 63 Z" fill="#e9eeff" />
          <circle cx="60" cy="60" r="6" fill="#0b1636" stroke="#22d3ee" strokeWidth="2" />
        </svg>
        <span className="absolute inset-0 flex flex-col justify-between p-4">
          <span className="pill self-start !border-transparent !bg-cyan/20 !text-cyan">NEW · DASHBOARD</span>
          <span className="pr-28">
            <span className="block text-[20px] font-bold leading-tight tracking-tight">Speedometer + AI Coach</span>
            <span className="block text-[13px] text-mute">Live speed, target pace and your coach</span>
          </span>
        </span>
      </button>

      {coach && (
        <button className="glass mt-4 block w-full p-4 text-left active:scale-[0.98]" onClick={() => go('coach')}>
          <div className="flex items-baseline justify-between">
            <span className="label">This week's goal</span>
            <span className="digits text-[13px] text-mute">{coach.doneMin} of {coach.goalMin} min</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full bg-gradient-to-r from-blue via-cyan to-violet" style={{ width: `${Math.min(100, (coach.doneMin / Math.max(1, coach.goalMin)) * 100)}%` }} />
          </div>
          <div className="mt-2 text-[13px] text-mute">{coach.tips[0]}</div>
        </button>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <button key={t.route} className="glass p-4 text-left transition-transform active:scale-[0.97]" onClick={() => go(t.route)}>
            <span className={`grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06] ${t.tone}`}>
              <Icon name={t.icon} />
            </span>
            <span className="mt-3 block font-semibold leading-tight">{t.title}</span>
            <span className="mt-0.5 block text-[12.5px] text-mute">{t.sub}</span>
          </button>
        ))}
      </div>

      <Footer />
    </>
  );
}
