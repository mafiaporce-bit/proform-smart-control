import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/icons';
import { Card, PageHeader, go } from '../components/ui';
import {
  EXPERIENCE,
  GOALS,
  aiAvailable,
  askAi,
  coachView,
  saveProfile,
  spokenSummary,
  useProfile,
  weekPlan,
  type CoachProfile,
  type Experience,
  type Goal,
} from '../lib/coach';
import { LEVELS, buildPlan, programById } from '../lib/programs';
import { listWorkouts, onDbChange, type Workout } from '../db/db';
import { useSettings } from '../lib/settings';
import { startWorkout, useWorkout } from '../lib/workout';
import { speak } from '../lib/voice';

function Choice<T extends string | number>({ value, options, onPick, cols = 2 }: { value: T | null; options: Array<{ id: T; label: string; hint?: string }>; onPick: (v: T) => void; cols?: number }) {
  return (
    <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o.id)}
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
          className={`btn !h-auto min-h-[48px] flex-col !gap-0 !px-2 py-2 text-center ${value === o.id ? '!border-cyan !bg-cyan/15 text-cyan' : ''}`}
        >
          <span>{o.label}</span>
          {o.hint && <span className="text-[11.5px] font-normal text-mute">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function Setup({ initial, onDone }: { initial: CoachProfile | null; onDone: () => void }) {
  const [goal, setGoal] = useState<Goal | null>(initial?.goal ?? null);
  const [exp, setExp] = useState<Experience | null>(initial?.experience ?? null);
  const [days, setDays] = useState<number>(initial?.days ?? 3);
  const [minutes, setMinutes] = useState<number>(initial?.minutes ?? 30);
  return (
    <div className="space-y-4">
      <Card>
        <div className="label">1 · What is your main goal?</div>
        <Choice value={goal} options={GOALS} onPick={setGoal} />
      </Card>
      <Card>
        <div className="label">2 · How much do you train now?</div>
        <Choice value={exp} options={EXPERIENCE} onPick={setExp} cols={1} />
      </Card>
      <Card>
        <div className="label">3 · Days a week</div>
        <Choice value={days} options={[2, 3, 4, 5, 6].map((d) => ({ id: d, label: String(d) }))} onPick={setDays} cols={5} />
        <div className="label mt-4">4 · Minutes a session</div>
        <Choice value={minutes} options={[15, 20, 30, 45, 60].map((m) => ({ id: m, label: String(m) }))} onPick={setMinutes} cols={5} />
      </Card>
      <p className="px-1 text-[12.5px] text-mute">
        If you have a heart condition, get chest pain or dizziness, or are returning after a long break or illness, check with a doctor before you start. Stop if you feel unwell.
      </p>
      <button
        className="btn btn-primary !min-h-[58px] w-full"
        disabled={!goal || !exp}
        onClick={() => {
          if (!goal || !exp) return;
          saveProfile({ goal, experience: exp, days, minutes });
          onDone();
        }}
      >
        <Icon name="spark" size={18} /> Build my plan
      </button>
    </div>
  );
}

function AiChat({ onAsk }: { onAsk: (q: string) => Promise<string> }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <div className="label">Ask the AI coach</div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e: { preventDefault(): void }) => {
          e.preventDefault();
          if (!q.trim() || busy) return;
          setBusy(true);
          setError(null);
          onAsk(q.trim())
            .then(setAnswer)
            .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong.'))
            .finally(() => setBusy(false));
        }}
      >
        <input className="field flex-1" value={q} onChange={(e: { target: { value: string } }) => setQ(e.target.value)} placeholder="How do I pace a 5 km run?" maxLength={600} aria-label="Question for the AI coach" />
        <button className="btn btn-violet" disabled={busy || !q.trim()}>{busy ? '…' : 'Ask'}</button>
      </form>
      {error && <p className="mt-2 text-[13px] text-bad" role="alert">{error} Your plan and tips still work without it.</p>}
      {answer && (
        <div className="mt-3 rounded-2xl border border-line bg-white/[0.03] p-3 text-[14px] leading-relaxed">
          {answer}
          <button className="btn btn-sm mt-2" onClick={() => void speak(answer, true)}><Icon name="volume" size={16} /> Read aloud</button>
        </div>
      )}
      <p className="mt-2 text-[12px] text-dim">Answers come from an AI model and can be wrong. It gives advice only and cannot control the treadmill.</p>
    </Card>
  );
}

export function Coach() {
  const profile = useProfile();
  const settings = useSettings();
  const workout = useWorkout();
  const [editing, setEditing] = useState(false);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [ai, setAi] = useState<boolean | null>(null);

  useEffect(() => {
    const load = () => listWorkouts().then(setWorkouts).catch(() => {});
    load();
    void aiAvailable().then(setAi);
    return onDbChange(load);
  }, []);

  const view = useMemo(() => (profile ? coachView(profile, workouts) : null), [profile, workouts]);

  if (!profile || editing) {
    return (
      <>
        <PageHeader title="AI Coach" sub={profile ? 'Change your answers' : 'Four quick questions'} back="more" />
        <Setup initial={profile} onDone={() => setEditing(false)} />
      </>
    );
  }
  if (!view) return null;

  const plan = weekPlan(profile);
  const pct = view.goalMin > 0 ? Math.min(1, view.doneMin / view.goalMin) : 0;
  const busy = workout.status !== 'idle';
  const goalLabel = GOALS.find((g) => g.id === profile.goal)?.label ?? '';

  return (
    <>
      <PageHeader
        title="AI Coach"
        sub={`${goalLabel} · ${profile.days} days · ${profile.minutes} min`}
        back="more"
        right={<button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>}
      />

      <div className="space-y-4">
        <Card hot>
          <div className="flex items-baseline justify-between">
            <div className="label">This week's goal</div>
            <div className="digits text-[13px] text-mute">{view.doneSessions}/{view.goalSessions} sessions</div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="digits text-[44px] font-light leading-none">{view.doneMin}</span>
            <span className="text-mute">of {view.goalMin} min</span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={view.goalMin} aria-valuenow={Math.min(view.doneMin, view.goalMin)}>
            <div className="h-full rounded-full bg-gradient-to-r from-blue via-cyan to-violet transition-[width] duration-500" style={{ width: `${pct * 100}%` }} />
          </div>
          <p className="mt-2 text-[13px] text-mute">{view.goalNote}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[12.5px] text-mute">
            <div><div className="digits text-[18px] font-semibold text-text">{view.doneKm.toFixed(1)}</div>km this week</div>
            <div><div className="digits text-[18px] font-semibold text-text">{view.streak}</div>day streak</div>
            <div><div className="digits text-[18px] font-semibold text-text">{view.lastWeekMin}</div>min last week</div>
          </div>
        </Card>

        {view.levelUp && (
          <Card className="!border-good/40">
            <div className="font-semibold text-good">You hit last week's plan</div>
            <p className="mt-1 text-[13px] text-mute">Ready for a little more? Add 5 minutes to each session.</p>
            <button className="btn btn-sm mt-2" onClick={() => saveProfile({ ...profile, minutes: Math.min(60, profile.minutes + 5) })}>
              Make sessions {Math.min(60, profile.minutes + 5)} minutes
            </button>
          </Card>
        )}

        <Card>
          <div className="flex items-center justify-between">
            <div className="label">Coach says</div>
            <button className="btn btn-sm" onClick={() => void speak(spokenSummary(profile, view), true)}><Icon name="volume" size={16} /> Listen</button>
          </div>
          <ul className="mt-2 space-y-2 text-[14px] leading-snug">
            {view.tips.map((t) => (
              <li key={t} className="flex gap-2.5"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-violet" /><span>{t}</span></li>
            ))}
          </ul>
        </Card>

        <div>
          <h2 className="label px-1">Your week</h2>
          <ul className="mt-2 space-y-2">
            {plan.map((s, i) => {
              const def = programById(s.programId);
              const lvl = LEVELS.find((l) => l.id === s.level)?.label;
              return (
                <li key={i} className="glass flex items-center gap-3 p-3.5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-[12px] font-bold text-cyan">{s.day}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{s.programName}</div>
                    <div className="text-[13px] text-mute">{lvl} · about {s.minutes} min</div>
                  </div>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy || !def}
                    aria-label={`Start ${s.programName}`}
                    onClick={() => {
                      if (!def) return;
                      startWorkout({ plan: buildPlan(def, s.level, settings.planMaxKmh, s.minutes) });
                      go('workout');
                    }}
                  >
                    <Icon name="play" size={14} /> Start
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 px-1 text-[12.5px] text-mute">Days are a suggestion. Any day counts. Keep at least one rest day a week.</p>
        </div>

        {ai === true && <AiChat onAsk={(q) => askAi(q, profile, view)} />}
        {ai === false && (
          <Card>
            <div className="label">AI chat: off</div>
            <p className="mt-1 text-[13px] text-mute">
              The plan and tips above run on the phone and need no AI service. A free-text AI chat can be switched on later by deploying from GitHub with an API key set in Netlify (see the README).
            </p>
          </Card>
        )}

        <p className="px-1 text-[12px] text-dim">The coach gives advice only. It never starts the treadmill or changes its speed, and it is not medical advice.</p>
      </div>
    </>
  );
}
