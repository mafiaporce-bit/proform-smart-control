import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/icons';
import { Card, ConnectButtons, PageHeader, StatusPill, SupportWarning, Toggle } from '../components/ui';
import { ble, lineOf, propsText, type LogEntry } from '../ble/manager';
import { useBle } from '../ble/useBle';
import { CHAR_1534, CHAR_1535, DFU_SERVICE_NEVER_USED, IFIT_SERVICE, REFERENCE_CAPTURE_HEX, UNKNOWN_SERVICE, shortUuid } from '../ble/constants';
import { clockTime, parseHex, sumMod256, toAscii, toBinary, toHex, u16be, u16le } from '../ble/packet';
import { clearBleSessions, listBleSessions, onDbChange, type BleSessionRecord } from '../db/db';
import { download, fileStamp } from '../lib/format';
import { SOURCES, candidateTelemetry, labelFrame } from '../ble/protocol';
import { PASS_SECONDS, ifitTest, useIfitTest, type StepResult } from '../ble/experiment';
import { KM_PER_MILE, findSpeedSlots, hex as hexOf, sampleProblem, type SpeedSample, type SpeedSlot, type SpeedUnit } from '../ble/ifit';
import { saveCal, useCal } from '../ble/speedcal';
import { setSettings, useSettings } from '../lib/settings';

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2 text-[13.5px]">
      <dt className="w-[118px] shrink-0 text-mute">{k}</dt>
      <dd className="min-w-0 flex-1 break-words font-medium">{children}</dd>
    </div>
  );
}

/** Every view of a packet's bytes. Interprets nothing as workout data. */
export function PacketDetail({ bytes }: { bytes: number[] }) {
  const [view, setView] = useState<'table' | 'u16' | 'ascii'>('table');
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap gap-1.5">
        {(['table', 'u16', 'ascii'] as const).map((v) => (
          <button key={v} className={`pill min-h-9 ${view === v ? '!border-cyan !text-cyan' : ''}`} onClick={() => setView(v)} aria-pressed={view === v}>
            {v === 'table' ? 'Bytes' : v === 'u16' ? '16-bit pairs' : 'Text'}
          </button>
        ))}
        <span className="pill">{bytes.length} bytes</span>
        <span className="pill">sum mod 256 = {sumMod256(bytes)}</span>
      </div>

      {view === 'table' && (
        <div className="mono mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-dim">
                <th className="py-1 pr-3 font-normal">#</th>
                <th className="py-1 pr-3 font-normal">hex</th>
                <th className="py-1 pr-3 font-normal">unsigned</th>
                <th className="py-1 pr-3 font-normal">signed</th>
                <th className="py-1 font-normal">bits</th>
              </tr>
            </thead>
            <tbody>
              {bytes.map((b, i) => (
                <tr key={i} className="border-t border-white/[0.05]">
                  <td className="py-1 pr-3 text-dim">{i}</td>
                  <td className="py-1 pr-3 text-cyan">{b.toString(16).padStart(2, '0').toUpperCase()}</td>
                  <td className="py-1 pr-3">{b}</td>
                  <td className="py-1 pr-3 text-mute">{b > 127 ? b - 256 : b}</td>
                  <td className="py-1 text-mute">{toBinary(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === 'u16' && (
        <div className="mono mt-3 space-y-2">
          <div><span className="text-dim">little-endian (decimal): </span>{u16le(bytes).join(' ')}</div>
          <div><span className="text-dim">big-endian (decimal): </span>{u16be(bytes).join(' ')}</div>
          {bytes.length % 2 === 1 && <div className="text-dim">Last byte has no partner and is left out.</div>}
        </div>
      )}
      {view === 'ascii' && <div className="mono mt-3 break-all">{toAscii(bytes)}</div>}

      <div className="mt-3 rounded-xl border border-line bg-white/[0.03] p-2.5 text-[12.5px] text-mute">
        <strong className="text-text">Frame shape:</strong> {labelFrame(bytes).text}
      </div>

      {candidateTelemetry(bytes) ? (
        (() => {
          const c = candidateTelemetry(bytes)!;
          return (
            <div className="mt-2 rounded-xl border border-warn/30 bg-warn/[0.06] p-2.5 text-[12.5px] text-mute">
              <strong className="text-warn">Candidate decode, unverified on the 105 CST.</strong> This frame matches the live-state layout of a NordicTrack T-series console (page 0x
              {c.page.toString(16).toUpperCase().padStart(2, '0')}). If the layout is the same here:
              <ul className="mono mt-1.5 space-y-0.5 text-text">
                <li>bytes 10-11 = {c.speedRaw} → speed {(c.speedRaw / 100).toFixed(2)} (km/h or mph, unit not confirmed)</li>
                <li>bytes 12-13 = {c.inclineRaw} → incline {(c.inclineRaw / 100).toFixed(1)}%</li>
                <li>byte 14 = {c.byte14} (seconds counter on one console, part of watts on another)</li>
              </ul>
              <p className="mt-1.5">Compare with the treadmill console before trusting any of it. The app does not use these numbers anywhere else.</p>
            </div>
          );
        })()
      ) : (
        <div className="mt-2 rounded-xl border border-line bg-white/[0.03] p-2.5 text-[12.5px] text-mute">
          <strong className="text-text">Parsed telemetry: none.</strong> This is not a recognised live-state frame, so nothing is turned into speed, distance, heart rate or calories.
        </div>
      )}
    </div>
  );
}

function PacketRow({ e }: { e: LogEntry }) {
  const [open, setOpen] = useState(false);
  const bytes = e.bytes ?? [];
  return (
    <li className="rounded-2xl border border-line bg-white/[0.03] p-3">
      <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`pill !px-2 !py-0.5 !text-[10.5px] ${e.kind === 'notify' ? '!text-cyan' : e.kind === 'tx' ? '!border-warn/50 !text-warn' : '!text-violet'}`}>{e.kind === 'notify' ? 'NOTIFY' : e.kind === 'tx' ? 'SENT' : 'READ'}</span>
        <span className="min-w-0 flex-1">
          <span className="mono block text-mute">{clockTime(e.t)} · {e.char} · {bytes.length} bytes</span>
          <span className={`mono block break-all ${open ? '' : 'line-clamp-2'}`}>{toHex(bytes)}</span>
        </span>
        <Icon name="chevron" size={16} className={`mt-1 shrink-0 text-dim transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <PacketDetail bytes={bytes} />}
    </li>
  );
}

function HexAnalyser() {
  const [text, setText] = useState('');
  const bytes = useMemo(() => (text.trim() ? parseHex(text) : null), [text]);
  return (
    <Card>
      <div className="label">Hex analyser</div>
      <p className="mt-1 text-[13px] text-mute">Paste any hex string to inspect it. Works offline, no treadmill needed.</p>
      <textarea
        className="field mono mt-3 !min-h-[88px] py-2.5"
        placeholder="68-FE-57-20…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Hex to analyse"
      />
      <div className="mt-2 flex gap-2">
        <button className="btn btn-sm flex-1" onClick={() => setText(REFERENCE_CAPTURE_HEX)}>Load my nRF capture</button>
        <button className="btn btn-sm" disabled={!text} onClick={() => setText('')}>Clear</button>
      </div>
      {text.trim() !== '' && bytes === null && <p className="mt-2 text-[13px] text-bad">That is not complete hex. Use pairs of 0-9 and A-F.</p>}
      {text === REFERENCE_CAPTURE_HEX && (
        <p className="mt-2 text-[12.5px] text-mute">This is the value you read from 1535 in nRF Connect. It is a raw read, not confirmed workout data.</p>
      )}
      {bytes && <PacketDetail bytes={bytes} />}
    </Card>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const unitName = (u: SpeedUnit) => (u === 'kmh' ? 'km/h' : 'mph');
const slotValue = (values: number[], slot: SpeedSlot) => (values[slot.offset] | (values[slot.offset + 1] << 8)) / slot.scale;

/**
 * Speed check: you set three speeds on the console, the app records the treadmill's reply at each,
 * and looks for the bytes that equal what the console showed. Only a match at all three counts.
 */
function SpeedCheckCard() {
  const s = useBle();
  const t = useIfitTest();
  const cal = useCal();
  const settings = useSettings();
  const polling = t.phase === 'polling';
  const now = useNow(polling || t.phase === 'questions' || t.phase === 'unlock' || t.phase === 'armed');
  const [agree, setAgree] = useState(false);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState('');
  const [unit, setUnit] = useState<SpeedUnit>('kmh');
  const [samples, setSamples] = useState<SpeedSample[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const freshReply = polling && t.lastValues !== null && t.lastTelemetryAt !== null && now - t.lastTelemetryAt < 2500;
  const busy = ['choosing', 'connecting', 'discovering'].includes(s.status);
  const starting = t.source !== 'test' && ['armed', 'questions', 'unlock'].includes(t.phase);
  const checking = open || !cal;

  const problem = sampleProblem(samples);
  const slots = useMemo(() => (problem ? [] : findSpeedSlots(samples)), [samples, problem]);
  // If several positions match, prefer hundredths, then the one that ramped through the most values (measured, not target).
  const best = useMemo(() => [...slots].sort((a, b) => b.scale - a.scale || ifitTest.variation(b.offset) - ifitTest.variation(a.offset) || a.offset - b.offset)[0] ?? null, [slots]);

  const start = () => {
    setMsg(null);
    if (!ifitTest.isRunning()) ifitTest.startSession('check');
    if (s.status !== 'connected') void (s.deviceName ? ble.reconnect() : ble.connect());
  };
  const record = () => {
    const v = Number(shown.replace(',', '.'));
    if (!Number.isFinite(v) || v < 0.5 || v > 25) { setMsg('Type the speed the console shows, for example 3.0'); return; }
    if (!freshReply || !t.lastValues) { setMsg('No fresh reply from the treadmill. Wait a moment and try again.'); return; }
    setSamples((a) => [...a, { shown: v, unit, values: t.lastValues!.slice(), at: Date.now() }]);
    ble.note('info', `SPEED CHECK reading ${samples.length + 1}: console shows ${v} ${unitName(unit)}; reply values ${hexOf(t.lastValues)}`);
    setShown(''); setMsg(null);
  };
  const save = () => {
    if (!best) return;
    saveCal({
      ...best, len: samples[0].values.length, savedAt: Date.now(),
      samples: samples.map((x) => ({ shown: x.shown, unit: x.unit, raw: x.values[best.offset] | (x.values[best.offset + 1] << 8) })),
      alsoMatched: slots.filter((x) => x !== best).map((x) => x.offset),
    });
    setSettings({ telemetryLink: true });
    ble.note('info', `SPEED VERIFIED: position ${best.offset}, divide by ${best.scale}, ${unitName(best.rawUnit)}. Matched ${samples.length} console readings. Telemetry link switched on.`);
    setSamples([]); setOpen(false); setMsg(null);
  };
  const forget = () => { saveCal(null); setSettings({ telemetryLink: false }); setSamples([]); setOpen(false); };
  const setLink = (on: boolean) => {
    setSettings({ telemetryLink: on });
    if (on && s.status === 'connected' && !ifitTest.isRunning()) ifitTest.startSession('live');
    if (!on && ifitTest.isRunning() && t.source === 'live') ifitTest.stop();
  };

  return (
    <Card hot={t.speedKmh !== null}>
      <div className="flex items-center gap-2">
        <span className={`pill ${cal ? '!border-good/40 !text-good' : '!border-warn/50 !text-warn'}`}>{cal ? 'Verified' : 'Not verified'}</span>
        <span className="label !mb-0">Treadmill speed</span>
      </div>

      {cal && (
        <>
          <div className="mt-3 rounded-xl border border-good/30 bg-good/[0.06] p-3" role="status">
            <div className="text-[12.5px] text-mute">Belt speed from the treadmill</div>
            <div className="digits mt-0.5 text-[34px] font-semibold leading-none">
              {t.speedKmh !== null ? t.speedKmh.toFixed(1) : '–'} <span className="text-[15px] font-normal text-mute">km/h</span>
            </div>
            <div className="mt-1 text-[12.5px] text-mute">
              {t.speedKmh !== null ? 'Live. Virtual Running follows this.' : s.status === 'connected' ? (settings.telemetryLink ? 'Waiting for the treadmill to answer…' : 'Telemetry link is off, so nothing is read.') : 'Connect the treadmill to read it.'}
            </div>
          </div>
          <Toggle
            on={settings.telemetryLink}
            onChange={setLink}
            label="Telemetry link"
            hint="On: every connection does the start-up handshake and reads speed with read-only polls, so the link stays open. Off: plain read-only, nothing is sent, and the treadmill drops the link after about 17 s."
          />
          <p className="text-[12px] text-dim">
            Verified {new Date(cal.savedAt).toLocaleDateString()} against {cal.samples.map((x) => `${x.shown} ${unitName(x.unit)}`).join(', ')}. Position {cal.offset}, ÷{cal.scale}, {unitName(cal.rawUnit)}
            {cal.alsoMatched.length ? `; position${cal.alsoMatched.length > 1 ? 's' : ''} ${cal.alsoMatched.join(', ')} matched too` : ''}.
          </p>
          {!open && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className="btn btn-sm" onClick={() => { setOpen(true); setSamples([]); setMsg(null); }}>Check again</button>
              <button className="btn btn-sm" onClick={forget}>Forget</button>
            </div>
          )}
        </>
      )}

      {checking && (
        <>
          <p className="mt-2 text-[13px] text-mute">
            Set three different speeds <strong className="text-text">on the treadmill console</strong> (for example 2, 3 and 4). At each one, type what the console shows and tap Record.
            The app only reads; it cannot change the speed. Speed counts as verified only if one position in the reply matches all three.
          </p>

          {!polling && (
            <>
              <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-white/[0.03] p-2.5 text-[13px]">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#22d3ee]" checked={agree} onChange={() => setAgree(!agree)} />
                <span>The safety key is clipped on, and I will set the speed from the console myself.</span>
              </label>
              <button className="btn btn-violet mt-3 w-full" disabled={!agree || busy || starting || s.support !== 'ok'} onClick={start}>
                {starting ? 'Starting…' : s.status === 'connected' ? 'Start speed check' : 'Connect and start speed check'}
              </button>
              {t.source !== 'test' && t.phase === 'ended' && t.verdict && <p className="mt-2 text-[12.5px] text-warn">{t.verdict}</p>}
            </>
          )}

          {polling && (
            <>
              <div className="mt-3 rounded-xl border border-line bg-white/[0.03] p-2.5 text-[12.5px]">
                <div className={freshReply ? 'text-good' : 'text-warn'}>{freshReply ? `Treadmill is answering (${t.telemetryReplies} replies)` : 'Waiting for a reply…'}</div>
                <div className="mono mt-1 break-all text-[11px] text-mute">{t.lastValues ? hexOf(t.lastValues) : '–'}</div>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  className="field digits flex-1"
                  inputMode="decimal"
                  placeholder={`Console speed ${samples.length + 1}`}
                  value={shown}
                  onChange={(e: { target: { value: string } }) => setShown(e.target.value)}
                  aria-label="Speed shown on the console"
                />
                <select className="field w-[92px]" value={unit} onChange={(e: { target: { value: string } }) => setUnit(e.target.value as SpeedUnit)} aria-label="Unit shown on the console">
                  <option value="kmh">km/h</option>
                  <option value="mph">mph</option>
                </select>
              </div>
              <button className="btn btn-primary mt-2 w-full" disabled={!freshReply || !shown.trim()} onClick={record}>Record this speed</button>
              <p className="mt-2 text-[12px] text-dim">Wait until the belt has settled and the console number is steady before you record.</p>
            </>
          )}
          {msg && <p className="mt-2 text-[13px] text-warn">{msg}</p>}

          {samples.length > 0 && (
            <div className="mt-3">
              <ul className="space-y-1.5">
                {samples.map((x, i) => (
                  <li key={x.at} className="mono flex justify-between gap-2 rounded-xl border border-line bg-white/[0.03] p-2">
                    <span>{i + 1}. console {x.shown} {unitName(x.unit)}</span>
                    <span className={best ? 'text-good' : 'text-mute'}>{best ? `reply ${slotValue(x.values, best).toFixed(2)} ${unitName(best.rawUnit)}` : 'recorded'}</span>
                  </li>
                ))}
              </ul>
              {problem ? (
                <p className="mt-2 text-[13px] text-mute">{problem}</p>
              ) : best ? (
                <div className="mt-2 rounded-xl border border-good/40 bg-good/[0.07] p-3 text-[13px]">
                  <div className="font-semibold text-good">Match at all {samples.length} speeds</div>
                  <p className="mt-1 text-mute">
                    Position {best.offset} of the reply, ÷{best.scale}, in {unitName(best.rawUnit)}
                    {best.rawUnit === 'mph' ? ` (×${KM_PER_MILE.toFixed(3)} for km/h)` : ''}.{slots.length > 1 ? ` ${slots.length - 1} other position${slots.length > 2 ? 's' : ''} matched too; this one changed most while the belt sped up.` : ''}
                  </p>
                  <button className="btn btn-violet mt-2 w-full" onClick={save}>Save as verified</button>
                </div>
              ) : (
                <div className="mt-2 rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-[13px]">
                  <div className="font-semibold text-warn">No match</div>
                  <p className="mt-1 text-mute">No position in the reply equals the console at all {samples.length} speeds. Nothing was saved. Check the numbers and unit, or send me the report.</p>
                </div>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button className="btn btn-sm" onClick={() => setSamples((a) => a.slice(0, -1))}>Remove last</button>
                <button className="btn btn-sm" onClick={() => download(`proform-speed-check-${fileStamp()}.txt`, ifitTest.reportText())}><Icon name="download" size={16} /> Report</button>
              </div>
            </div>
          )}
          {cal && open && <button className="btn btn-sm mt-2 w-full" onClick={() => { setOpen(false); setSamples([]); }}>Close</button>}
        </>
      )}
    </Card>
  );
}

const STEP_TONE: Record<StepResult['status'], string> = { pending: 'text-dim', sending: 'text-cyan', answered: 'text-good', 'no reply': 'text-warn', error: 'text-bad' };

/** Experimental iFit Telemetry Mode: the two-step, user-authorised stability test. */
function ExperimentCard() {
  const s = useBle();
  const t = useIfitTest();
  const live = ['questions', 'waiting', 'unlock', 'polling'].includes(t.phase);
  const now = useNow(live);
  const [checks, setChecks] = useState([false, false, false]);
  const allChecked = checks.every(Boolean);
  const secs = t.connectedAt ? ((t.endedAt ?? now) - t.connectedAt) / 1000 : 0;
  const answered = t.steps.filter((x) => x.status === 'answered').length;
  const c = t.candidate;
  const busy = ['choosing', 'connecting', 'discovering'].includes(s.status);
  const tick = (i: number) => setChecks((a) => a.map((v, k) => (k === i ? !v : v)));
  const start = () => {
    ifitTest.arm(true);
    if (s.status !== 'connected') void (s.deviceName ? ble.reconnect() : ble.connect());
  };
  return (
    <Card className={live ? '!border-warn/50' : ''}>
      <div className="flex items-center gap-2">
        <span className="pill !border-warn/50 !text-warn"><Icon name="lock" size={12} /> Experimental</span>
        <span className="label !mb-0">iFit Telemetry Mode</span>
      </div>
      <p className="mt-2 text-[13px] text-mute">
        Tests whether talking to the console keeps the link open. It sends only start-up questions, one unlock message (step 2) and read-only polls. The app refuses to send
        anything that sets speed, incline or start. Confirmed on this 105 CST on 22 Nov 2026: all questions answered, unlock accepted, link held 72 s.
      </p>

      {!live && t.phase !== 'armed' && (
        <>
          <div className="mt-3 space-y-1.5">
            {['The belt is stopped and nobody is on the treadmill.', 'The safety key is within reach, and I will pull it if the belt ever moves.', 'I understand these packets come from a related iFit console and are a test on my treadmill.'].map((label, i) => (
              <label key={i} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-white/[0.03] p-2.5 text-[13px]">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#22d3ee]" checked={checks[i]} onChange={() => tick(i)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <Toggle
            on={t.allowUnlock}
            onChange={(v) => ifitTest.allowUnlock(v)}
            label="Step 2: allow the unlock message and polling"
            hint="Your 105 CST accepted this unlock in the first test. Off = step 1 only (questions), then the test waits for you."
          />
          <button className="btn btn-violet mt-3 w-full" disabled={!allChecked || busy || s.support !== 'ok'} onClick={start}>
            {s.status === 'connected' ? 'Start test now' : 'Connect and run the test'}
          </button>
          {!allChecked && <p className="mt-2 text-[12px] text-dim">Tick the three boxes to enable the test. This is asked again for every run.</p>}
        </>
      )}

      {t.phase === 'armed' && (
        <div className="mt-3 rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-[13px]">
          <div className="font-semibold text-warn">Armed. Waiting for the connection…</div>
          <p className="mt-1 text-mute">Pick I_TL in the browser's list. The test starts the moment the link is up.</p>
          <button className="btn btn-sm mt-2" onClick={() => { ifitTest.arm(false); }}>Cancel</button>
        </div>
      )}

      {(live || t.phase === 'stopped' || t.phase === 'ended') && (
        <>
          <div className={`mt-3 rounded-xl border p-3 text-[13.5px] ${t.passedAt ? 'border-good/40 bg-good/[0.07]' : live ? 'border-cyan/30 bg-cyan/[0.05]' : 'border-warn/30 bg-warn/[0.06]'}`} role="status">
            <div className="font-semibold">
              {live
                ? t.phase === 'questions' ? 'Step 1: asking the console…' : t.phase === 'waiting' ? 'Step 1 done. Waiting for you.' : t.phase === 'unlock' ? 'Step 2: sending the unlock…' : t.passedAt ? `Target reached: ${PASS_SECONDS} s with telemetry` : 'Polling (read-only)…'
                : 'Test finished'}
            </div>
            {t.verdict && <p className="mt-1 text-mute">{t.verdict}</p>}
            {live && !t.passedAt && <p className="mt-1 text-mute">Connected does not count as success. The target is {PASS_SECONDS} s connected with valid replies to polls.</p>}
          </div>

          {t.phase === 'waiting' && (
            <div className="mt-3 rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-[13px]">
              <p>
                The console answered <strong>{answered} of {t.steps.length}</strong> questions.{' '}
                {answered === 0 ? 'With no answers, this console may speak differently, so the unlock is not sent automatically.' : 'Question 1 is repeated every 3 s meanwhile, to see if that alone holds the link.'}
              </p>
              {!t.allowUnlock && <Toggle on={t.allowUnlock} onChange={(v) => ifitTest.allowUnlock(v)} label="Allow step 2 (unlock + polling)" hint="Accepted by your 105 CST in the first test." />}
              <button className="btn btn-violet mt-2 w-full" disabled={!t.allowUnlock} onClick={() => ifitTest.sendUnlockNow()}>Send unlock and start polling</button>
            </div>
          )}

          <dl className="mt-2 divide-y divide-line">
            <Row k="Connected for">{secs.toFixed(1)} s{t.passedAt ? ' ✓' : ''}</Row>
            <Row k="Service 1533">{s.serviceFound || t.endedAt ? 'Found' : '–'}</Row>
            <Row k="Notifications">{s.notifying ? 'Enabled on 1535' : t.endedAt ? 'Ended with the link' : 'Off'}</Row>
            <Row k="Init progress">{answered}/{t.steps.length} questions answered · unlock: {t.unlock.status}</Row>
            <Row k="Requests sent">{t.requests} ({t.pollsSent} polls, {t.keepAliveAsks} repeat questions) · {s.txFrames} frames</Row>
            <Row k="Replies">{t.replies} whole · {t.telemetryReplies} to polls · {t.malformed} unreadable</Row>
            <Row k="Reply checksums">{t.checksumOk} ok · {t.checksumBad} not matching</Row>
            <Row k="Poll in use">{t.pollVariant ?? '–'}</Row>
            <Row k="Decoded speed">
              <span className="text-warn">Not verified.</span>{' '}
              {c ? <span className="mono">candidate: first value {c.speedRaw} ({(c.speedRaw / 100).toFixed(2)} if hundredths), second {c.inclineRaw}</span> : 'No poll reply yet.'}
            </Row>
            <Row k="Last reply"><span className="mono break-all text-[12px]">{t.lastReplyHex ?? '–'}</span></Row>
            <Row k="Last disconnect">{t.lastDisconnect ?? (live ? '–' : s.lastDisconnect ?? '–')}</Row>
            {t.error && <Row k="Error"><span className="text-bad">{t.error}</span></Row>}
          </dl>

          <details className="mt-2 text-[13px]" open={t.phase === 'questions' || t.phase === 'waiting'}>
            <summary className="min-h-9 cursor-pointer py-2 font-medium">Start-up steps and replies</summary>
            <ol className="space-y-1.5">
              {[...t.steps, t.unlock].map((x, i) => (
                <li key={x.id} className="rounded-xl border border-line bg-white/[0.03] p-2">
                  <div className="flex justify-between gap-2">
                    <span>{i + 1}. {x.label}</span>
                    <span className={STEP_TONE[x.status]}>{x.status}{x.ms !== null ? ` · ${x.ms} ms` : ''}</span>
                  </div>
                  {x.reply && <div className="mono mt-1 break-all text-[11.5px] text-mute">{x.reply}</div>}
                  {x.note && <div className="mt-1 text-[12px] text-warn">{x.note}</div>}
                </li>
              ))}
            </ol>
          </details>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {live ? (
              <button className="btn btn-sm" onClick={() => ifitTest.stop()}>Stop sending</button>
            ) : (
              <button className="btn btn-sm" onClick={() => { setChecks([false, false, false]); ifitTest.arm(false); }}>New test</button>
            )}
            <button className="btn btn-sm" onClick={() => download(`proform-ifit-test-${fileStamp()}.txt`, ifitTest.reportText())}><Icon name="download" size={16} /> Report</button>
          </div>
          <p className="mt-2 text-[12px] text-dim">Send me the report file after each run. Every sent and received frame is in it with its time.</p>
        </>
      )}
    </Card>
  );
}

export function Diagnostics() {
  const s = useBle();
  const t = useIfitTest();
  const now = useNow(s.status === 'connected');
  const [tab, setTab] = useState<'packets' | 'log'>('packets');
  const [saved, setSaved] = useState<BleSessionRecord[]>([]);

  useEffect(() => {
    const load = () => listBleSessions().then(setSaved).catch(() => {});
    load();
    return onDbChange(load);
  }, []);

  // s.logVersion changes whenever the log does, which re-renders this page.
  const log = ble.getLog();
  const packets = log.filter((e) => e.bytes);
  const shownPackets = packets.slice(-150).reverse();
  const shownLog = log.slice(-300).reverse();
  const connected = s.status === 'connected';
  const unexpected = s.sessions.filter((x) => !x.userEnded);
  const stamp = fileStamp();

  const exportSaved = () =>
    download(
      `proform-ble-sessions-${stamp}.json`,
      JSON.stringify({ app: 'ProForm Smart Control', exportedAt: new Date().toISOString(), note: 'Log lines of kind "tx" are frames the app sent in Experimental iFit Telemetry Mode.', sessions: saved }, null, 2),
      'application/json',
    );

  return (
    <>
      <PageHeader title="Bluetooth Lab" sub="Compatibility tester" back="more" right={<StatusPill />} />

      <div className="space-y-4">
        <SupportWarning />

        <Card hot={connected}>
          {s.mode === 'experimental' ? (
            <div className="flex items-center gap-2">
              <span className="pill !border-warn/50 !text-warn"><Icon name="lock" size={12} /> {t.source === 'live' ? 'Telemetry link' : 'Experimental mode'}</span>
              <span className="text-[12.5px] text-mute">Questions and read-only polls are being sent{t.source === 'live' ? '' : ` (${s.txFrames} frames)`}.</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="pill !border-good/40 !text-good"><Icon name="lock" size={12} /> Read-only mode</span>
              <span className="text-[12.5px] text-mute">Nothing is written to the treadmill.</span>
            </div>
          )}
          <dl className="mt-2 divide-y divide-line">
            <Row k="Device name">{s.deviceName ?? '–'}</Row>
            <Row k="Browser device ID"><span className="mono">{s.deviceId ?? '–'}</span></Row>
            <Row k="Status">{s.status}{s.reconnectAttempt > 0 && !connected ? ` (auto-reconnect ${s.reconnectAttempt}/5)` : ''}</Row>
            <Row k="Service 1533">{s.serviceFound ? 'Found' : s.deviceName ? 'Not found yet' : '–'}</Row>
            <Row k="Notifications">{s.notifying ? 'Enabled on 1535' : 'Off'}</Row>
            <Row k="Session time">{connected && s.connectedAt ? `${((now - s.connectedAt) / 1000).toFixed(1)} s` : '–'}</Row>
            <Row k="Packets">{s.sessionPackets} this session · {packets.length} in log</Row>
            <Row k="Last packet">{s.lastPacketAt ? clockTime(s.lastPacketAt) : '–'}</Row>
            <Row k="Last disconnect">{s.lastDisconnect ?? '–'}</Row>
            {s.lastError && <Row k="Last error"><span className="text-bad">{s.lastError}</span></Row>}
          </dl>
          <p className="mt-2 text-[12px] text-dim">
            A web page is never given the treadmill's Bluetooth address (FD:4B:…) or the disconnect code (such as status 19). The browser ID above is made up by Chrome for this site.
          </p>
          <div className="mt-3 space-y-2">
            <ConnectButtons />
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-sm" disabled={!connected} onClick={() => void ble.read('1535')}>Read 1535</button>
              <button className="btn btn-sm" disabled={!connected} onClick={() => void ble.read('1534')}>Read 1534</button>
            </div>
            {!connected && (
              <button className="btn btn-sm w-full" disabled={s.support !== 'ok'} onClick={() => void ble.connect(true)}>
                I_TL not listed? Show all nearby devices
              </button>
            )}
          </div>
          <Toggle
            on={s.autoReconnect}
            onChange={(v) => ble.setAutoReconnect(v)}
            label="Auto-reconnect"
            hint="Up to 5 tries after a drop. Listens only, sends no commands, keeps the page open."
          />
        </Card>

        <SpeedCheckCard />

        <ExperimentCard />

        <Card>
          <div className="label">Characteristics</div>
          {s.chars.length === 0 ? (
            <p className="mt-2 text-[13px] text-mute">Connect to list what the treadmill offers. Expected: 1534 (read, write) and 1535 (read, notify).</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {s.chars.map((c) => (
                <li key={c.uuid} className="rounded-2xl border border-line bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {c.short}
                      {c.service !== IFIT_SERVICE && <span className="ml-2 text-[12px] font-normal text-mute">unknown service, listed only</span>}
                    </span>
                    <span className="text-[12px] text-cyan">{propsText(c)}</span>
                  </div>
                  <div className="mono mt-1 break-all text-mute">{c.uuid}</div>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-3 text-[13px] text-mute">
            <summary className="min-h-9 cursor-pointer py-2 font-medium text-text">Service map</summary>
            <ul className="mono space-y-1.5 break-all">
              <li><span className="text-good">used</span> {IFIT_SERVICE} (iFit service {shortUuid(IFIT_SERVICE)})</li>
              <li><span className="text-good">read, notify</span> {CHAR_1535}</li>
              <li><span className="text-warn">read; written only by the experimental test</span> {CHAR_1534}</li>
              <li><span className="text-mute">listed only</span> {UNKNOWN_SERVICE}</li>
              <li><span className="text-bad">never requested</span> {DFU_SERVICE_NEVER_USED} (firmware update)</li>
            </ul>
          </details>
        </Card>

        <Card>
          <div className="label">Disconnect pattern</div>
          {s.sessions.length === 0 ? (
            <p className="mt-2 text-[13px] text-mute">No sessions yet. Each connection is timed so you can see how long the treadmill keeps the link open.</p>
          ) : (
            <>
              <ul className="mt-2 space-y-1.5">
                {s.sessions.slice(0, 8).map((x) => (
                  <li key={x.startedAt} className="mono flex justify-between gap-2">
                    <span className="text-mute">{clockTime(x.startedAt)}</span>
                    <span>{(x.durationMs / 1000).toFixed(1)} s</span>
                    <span>{x.packets} pkt</span>
                    <span className={x.userEnded ? 'text-mute' : 'text-warn'}>{x.userEnded ? 'you ended' : 'link lost'}</span>
                  </li>
                ))}
              </ul>
              {unexpected.length >= 2 && (
                <p className="mt-3 text-[13px] text-mute">
                  {unexpected.length} drops, average {(unexpected.reduce((a, x) => a + x.durationMs, 0) / unexpected.length / 1000).toFixed(1)} s. Drops at a steady interval would fit a
                  treadmill that waits for a start-up handshake and then gives up. That is a theory from related iFit models, not yet proven on the 105 CST.
                </p>
              )}
            </>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-2">
            <div className="glass flex flex-1 gap-1 !rounded-xl p-1" role="tablist">
              {(['packets', 'log'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`min-h-10 flex-1 rounded-lg text-[13px] font-semibold ${tab === t ? 'bg-white/10' : 'text-mute'}`}
                >
                  {t === 'packets' ? `Packets (${packets.length})` : `Log (${log.length})`}
                </button>
              ))}
            </div>
          </div>

          {tab === 'packets' &&
            (shownPackets.length === 0 ? (
              <p className="mt-3 text-[13px] text-mute">No packets received yet. Reads and notifications from the treadmill appear here with the time, length and raw bytes.</p>
            ) : (
              <ul className="mt-3 space-y-2">{shownPackets.map((e) => <PacketRow key={e.id} e={e} />)}</ul>
            ))}

          {tab === 'log' &&
            (shownLog.length === 0 ? (
              <p className="mt-3 text-[13px] text-mute">The log is empty. Connection steps are written here as they happen.</p>
            ) : (
              <ol className="mono mt-3 max-h-[420px] space-y-1 overflow-y-auto">
                {shownLog.map((e) => (
                  <li key={e.id} className={`break-words ${e.kind === 'error' ? 'text-bad' : e.kind === 'warn' ? 'text-warn' : e.bytes ? 'text-cyan' : 'text-mute'}`}>
                    {lineOf(e)}
                  </li>
                ))}
              </ol>
            ))}

          <div className="mt-3 grid grid-cols-4 gap-2">
            <button className="btn btn-sm !px-0" disabled={!log.length} onClick={() => download(`proform-ble-log-${stamp}.txt`, ble.exportText())}>TXT</button>
            <button className="btn btn-sm !px-0" disabled={!packets.length} onClick={() => download(`proform-ble-packets-${stamp}.csv`, ble.exportCsv(), 'text/csv')}>CSV</button>
            <button className="btn btn-sm !px-0" disabled={!log.length} onClick={() => download(`proform-ble-log-${stamp}.json`, ble.exportJson(), 'application/json')}>JSON</button>
            <button className="btn btn-sm !px-0" disabled={!log.length} onClick={() => ble.clearLog()}>Clear</button>
          </div>
          <p className="mt-2 text-[12px] text-dim">Exports download to your phone. The log keeps the newest 4,000 lines.</p>
        </Card>

        <Card>
          <div className="label">Saved sessions</div>
          <p className="mt-1 text-[13px] text-mute">
            {saved.length
              ? `${saved.length} connection${saved.length === 1 ? '' : 's'} saved on this phone, each with its full log.`
              : 'Every connection is saved here when it ends, so nothing is lost if the page reloads.'}
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-sm flex-1" disabled={!saved.length} onClick={exportSaved}><Icon name="download" size={16} /> Export all</button>
            <button className="btn btn-sm" disabled={!saved.length} onClick={() => void clearBleSessions()}>Delete</button>
          </div>
        </Card>

        <HexAnalyser />

        <Card>
          <div className="label">Protocol research</div>
          <p className="mt-2 text-[13px] text-mute">
            From two open-source projects for related iFit consoles that also show up as I_TL. None of it has been confirmed on the 105 CST.
          </p>
          <ul className="mt-2 space-y-2 text-[13.5px] leading-snug">
            {[
              ['Nothing is pushed', 'The console only answers when the phone asks. A listen-only link, like this one, is expected to stay silent.'],
              ['Why it drops', 'On the reference console, links that only subscribed dropped after about 10 to 20 seconds. Links polled every 200 ms stayed up. That matches your nRF Connect log.'],
              ['Handshake', 'Before polling, the other apps replay a fixed start-up sequence to 1534. Its meaning was never decoded and it differs between models.'],
              ['Framing', '20-byte frames. FE starts a message, small numbers continue it, FF ends it.'],
              ['Live data', 'Speed and incline sit in one 20-byte frame as hundredths. Distance, time and calories are not sent. Apps work them out from speed.'],
              ['Speed commands', 'A known layout exists, with a checksum that changes between model families. Start and stop commands are not documented.'],
            ].map(([k, v]) => (
              <li key={k}><span className="font-semibold">{k}.</span> <span className="text-mute">{v}</span></li>
            ))}
          </ul>
          <p className="mt-3 rounded-xl border border-warn/30 bg-warn/[0.06] p-2.5 text-[12.5px] text-[#ffe9b0]">
            What this means: to keep the link open and read speed, the app has to talk to the console. Ordinary read-only mode still sends nothing. The Experimental iFit Telemetry
            test above sends the related console's start-up questions, unlock and read-only polls, only after you allow it, and records what your treadmill answers.
          </p>
          <ul className="mt-3 space-y-1.5 text-[12.5px]">
            {SOURCES.map((x) => (
              <li key={x.url}><a className="inline-block min-h-9 py-1.5 text-cyan underline underline-offset-4" href={x.url} target="_blank" rel="noreferrer">{x.name}</a></li>
            ))}
          </ul>
        </Card>

        <Card>
          <div className="label">Outgoing packets</div>
          <p className="mt-2 text-[13px] text-mute">
            Read-only mode sends nothing. The telemetry session (stability test, speed check, telemetry link) is the only thing that writes, to 1534. It can send start-up
            questions, the unlock message and read-only polls. The test and the speed check list every frame under Packets as SENT; the telemetry link only counts them.
            A message that would set speed, incline or start is refused by the app before anything is written. There is no free-form
            write box and no firmware update access anywhere in this app.
          </p>
          <p className="mt-2 text-[13px]">Frames sent on this connection: <strong>{s.txFrames}</strong></p>
        </Card>
      </div>
    </>
  );
}
