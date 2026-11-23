import { useEffect, useState } from 'react';
import { Icon } from '../components/icons';
import { Card, Footer, PageHeader, Toggle } from '../components/ui';
import { setSettings, useSettings } from '../lib/settings';
import { coachSay, coachVoiceAvailable, resetCoachVoiceProbe, stopCoach } from '../lib/coachvoice';
import { DASH_STYLES, StylePicker } from '../components/Dashboard';
import { KOKORO_VOICES, kokoroFailReason, loadKokoro, speak, stopSpeaking, useKokoroStatus } from '../lib/voice';
import { isInstalled, promptInstall, useCanInstall } from '../lib/install';
import { clearWorkouts, listWorkouts } from '../db/db';
import { download, fileStamp } from '../lib/format';
import { workoutsCsv } from './History';

export function SettingsPage() {
  const s = useSettings();
  const kokoro = useKokoroStatus();
  const canInstall = useCanInstall();
  const [confirmClear, setConfirmClear] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [charlie, setCharlie] = useState<'checking' | 'ready' | 'off' | null>(null);

  useEffect(() => {
    if (s.coachVoice !== 'charlie') { setCharlie(null); return; }
    let live = true;
    setCharlie('checking');
    void coachVoiceAvailable().then((ok) => { if (live) setCharlie(ok ? 'ready' : 'off'); });
    return () => { live = false; };
  }, [s.coachVoice]);

  const kokoroText =
    kokoro === 'ready'
      ? 'Kokoro voice is loaded and ready.'
      : kokoro === 'loading'
        ? 'Loading voice… this is a large one-time download. The phone voice is used until it is ready.'
        : kokoro === 'failed'
          ? `Kokoro could not load (${kokoroFailReason() || 'no connection'}). Using the phone voice instead.`
          : 'Kokoro downloads its voice the first time it speaks (large, needs internet once).';

  return (
    <>
      <PageHeader title="Settings" back="more" />

      <div className="space-y-4">
        <Card>
          <div className="label">You</div>
          <label className="mt-2 flex items-center justify-between gap-3">
            <span>
              <span className="block font-medium">Body weight</span>
              <span className="block text-[12.5px] text-mute">Used only for the calorie estimate</span>
            </span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min={30}
                max={200}
                className="field !w-[88px] text-center"
                value={s.weightKg}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0 && v <= 300) setSettings({ weightKg: v });
                }}
              />
              <span className="text-mute">kg</span>
            </span>
          </label>
        </Card>

        <Card>
          <div className="label">Programs</div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span>
              <span className="block font-medium">Top speed for plans</span>
              <span className="block text-[12.5px] text-mute">No program or coach session will suggest more than this. Your own comfort cap, not a treadmill setting.</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <button className="btn btn-sm w-11 !px-0" aria-label="Lower top speed" onClick={() => setSettings({ planMaxKmh: Math.max(4, s.planMaxKmh - 0.5) })}><Icon name="minus" size={18} /></button>
              <span className="digits w-12 text-center font-semibold">{s.planMaxKmh.toFixed(1)}</span>
              <button className="btn btn-sm w-11 !px-0" aria-label="Raise top speed" onClick={() => setSettings({ planMaxKmh: Math.min(16, s.planMaxKmh + 0.5) })}><Icon name="plus" size={18} /></button>
            </span>
          </div>
        </Card>

        <Card>
          <div className="label">Voice</div>
          <Toggle on={s.voiceOn} onChange={(v) => { setSettings({ voiceOn: v }); if (!v) { stopSpeaking(); stopCoach(); } }} label="Voice guidance" hint="Spoken start, pause and finish messages" />
          <Toggle on={s.kmAnnounce} onChange={(v) => setSettings({ kmAnnounce: v })} label="Announce every kilometre" />
          <Toggle on={s.cheer} onChange={(v) => setSettings({ cheer: v })} label="Encouragement" hint="A short spoken boost every 5 minutes" />

          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['kokoro', 'phone'] as const).map((e) => (
              <button
                key={e}
                className={`btn btn-sm ${s.voiceEngine === e ? '!border-cyan !bg-cyan/15 text-cyan' : ''}`}
                aria-pressed={s.voiceEngine === e}
                onClick={() => setSettings({ voiceEngine: e })}
              >
                {e === 'kokoro' ? 'Kokoro voice' : 'Phone voice'}
              </button>
            ))}
          </div>

          {s.voiceEngine === 'kokoro' && (
            <>
              <label className="mt-3 block">
                <span className="mb-1 block text-[13px] text-mute">Kokoro voice</span>
                <select className="field" value={s.kokoroVoice} onChange={(e) => setSettings({ kokoroVoice: e.target.value })}>
                  {KOKORO_VOICES.map((v) => (
                    <option key={v.id} value={v.id} className="bg-panel">{v.label}</option>
                  ))}
                </select>
              </label>
              <p className="mt-2 flex items-start gap-2 text-[12.5px] text-mute" role="status">
                <span className={`dot mt-1 ${kokoro === 'ready' ? 'dot-live' : kokoro === 'loading' ? 'dot-busy' : kokoro === 'failed' ? 'dot-bad' : ''}`} />
                {kokoroText}
              </p>
            </>
          )}

          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary flex-1" onClick={() => void speak('Great pace. Two more minutes, then we slow it down.', true)}>
              <Icon name="volume" size={18} /> Test voice
            </button>
            {s.voiceEngine === 'kokoro' && kokoro !== 'ready' && (
              <button className="btn" disabled={kokoro === 'loading'} onClick={() => void loadKokoro().catch(() => {})}>
                {kokoro === 'loading' ? 'Loading…' : 'Load now'}
              </button>
            )}
          </div>
        </Card>

        <Card>
          <div className="label">Workout dashboard</div>
          <p className="mt-1 text-[13px] text-mute">Style: {DASH_STYLES.find((x) => x.id === s.dashStyle)?.long}. You can also switch it on the workout screen.</p>
          <StylePicker className="mt-2" />
          <div className="mt-3 text-[13px] text-mute">Coach picture</div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {(['male', 'female'] as const).map((g) => (
              <button
                key={g}
                className={`btn btn-sm ${s.coachAvatar === g ? '!border-cyan !bg-cyan/15 text-cyan' : ''}`}
                aria-pressed={s.coachAvatar === g}
                onClick={() => setSettings({ coachAvatar: g })}
              >
                {g === 'male' ? 'Male coach' : 'Female coach'}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <div className="label">Coach voice</div>
          <p className="mt-1 text-[13px] text-mute">Who pushes you during a run. The trainer is a real human-sounding coach.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['standard', 'charlie'] as const).map((c) => (
              <button
                key={c}
                className={`btn btn-sm ${s.coachVoice === c ? '!border-cyan !bg-cyan/15 text-cyan' : ''}`}
                aria-pressed={s.coachVoice === c}
                onClick={() => { resetCoachVoiceProbe(); setSettings({ coachVoice: c }); }}
              >
                {c === 'standard' ? 'Standard' : 'Charlie trainer'}
              </button>
            ))}
          </div>

          {s.coachVoice === 'charlie' && !s.voiceOn && (
            <div className="mt-3 rounded-xl border border-warn/40 bg-warn/[0.08] p-3 text-[13px] text-[#ffe9b0]" role="alert">
              Voice guidance is off, so Charlie stays silent.
              <button className="btn btn-sm mt-2 w-full" onClick={() => setSettings({ voiceOn: true })}>Turn on voice guidance</button>
            </div>
          )}
          {s.coachVoice === 'charlie' && (
            <>
              <p className="mt-2 flex items-start gap-2 text-[12.5px] text-mute" role="status">
                <span className={`dot mt-1 ${charlie === 'ready' ? 'dot-live' : charlie === 'checking' ? 'dot-busy' : charlie === 'off' ? 'dot-bad' : ''}`} />
                {charlie === 'ready'
                  ? 'Charlie is live. Lines are saved after the first play, so they work offline too.'
                  : charlie === 'checking'
                    ? 'Checking the coach voice service…'
                    : charlie === 'off'
                      ? 'Charlie is not set up on this site yet, so the standard voice is used. It needs the ELEVENLABS_API_KEY on Netlify and a GitHub or CLI deploy (drag-and-drop does not include functions).'
                      : ''}
              </p>
              <button className="btn btn-primary mt-3 w-full" onClick={() => { if (!s.voiceOn) setSettings({ voiceOn: true }); void coachSay('push1'); }}>
                <Icon name="volume" size={18} /> Test Charlie
              </button>
            </>
          )}
        </Card>

        <Card>
          <div className="label">Screen</div>
          <Toggle on={s.keepAwake} onChange={(v) => setSettings({ keepAwake: v })} label="Keep screen on during a workout" hint="Also helps the Bluetooth link, which needs the app open" />
        </Card>

        <Card>
          <div className="label">Install</div>
          {isInstalled() ? (
            <p className="mt-2 text-[13.5px] text-mute">Installed. You are running it as an app.</p>
          ) : canInstall ? (
            <button className="btn btn-primary mt-2 w-full" onClick={() => void promptInstall()}><Icon name="phone" size={18} /> Install app</button>
          ) : (
            <p className="mt-2 text-[13.5px] text-mute">In Chrome, open the ⋮ menu and choose "Add to Home screen" or "Install app".</p>
          )}
        </Card>

        <Card>
          <div className="label">Your data</div>
          <p className="mt-1 text-[13px] text-mute">Workouts and Bluetooth logs stay on this phone. Nothing is uploaded.</p>
          <div className="mt-3 flex gap-2">
            <button
              className="btn btn-sm flex-1"
              onClick={() => void listWorkouts().then((all) => download(`proform-workouts-${fileStamp()}.csv`, workoutsCsv(all), 'text/csv'))}
            >
              <Icon name="download" size={16} /> Export CSV
            </button>
            <button className="btn btn-sm btn-danger flex-1" onClick={() => { setConfirmClear(true); setCleared(false); }}>
              <Icon name="trash" size={16} /> Delete workouts
            </button>
          </div>
          {confirmClear && (
            <div className="mt-3 rounded-2xl border border-bad/30 bg-bad/[0.07] p-3">
              <p className="text-[13.5px]">Delete every saved workout? This cannot be undone.</p>
              <div className="mt-2 flex gap-2">
                <button className="btn btn-sm flex-1" onClick={() => setConfirmClear(false)}>Keep them</button>
                <button className="btn btn-sm btn-danger flex-1" onClick={() => void clearWorkouts().then(() => { setConfirmClear(false); setCleared(true); })}>Delete all</button>
              </div>
            </div>
          )}
          {cleared && <p className="mt-2 text-[13px] text-mute" role="status">All workouts deleted.</p>}
        </Card>

        <Card>
          <div className="label">About</div>
          <p className="mt-2 text-[13.5px] text-mute">
            ProForm Smart Control 0.5. Unofficial app, not made by or connected with ProForm or iFIT. It is not a medical device. Calories are estimates.
          </p>
        </Card>
      </div>
      <Footer />
    </>
  );
}
