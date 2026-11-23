// The iFit telemetry session: start-up questions, unlock, then read-only polls.
// Three ways to run it, all through the same guarded write function:
//   'test'   the stability test in the Bluetooth Lab (three tick boxes, two-step permission)
//   'check'  the speed check in the Bluetooth Lab (records replies at speeds set on the console)
//   'live'   the telemetry link: runs by itself on every connection, ONLY after the speed check
//            has verified the speed position and the user has left the link switched on
// Confirmed on this ProForm 105 CST on 22 Nov 2026: all six questions answered, unlock accepted,
// 47 of 47 polls answered with matching checksums, link held 72 s (it drops at about 17 s when silent).
//
// It uses the existing connection manager (no second Bluetooth connection) and can only send
// through ble.sendIfit(), which refuses anything except start-up questions, the unlock message
// (step 2 permission) and read-only polls. See ./ifit for the reasoning and the guard.
//
// Flow, once the user has armed it and connected:
//   step 1  ask the six start-up questions one by one and record each reply
//   wait    (only if step 2 is not allowed yet) keep asking question 1 every 3 s so the test also
//           shows whether questions alone keep the link open
//   step 2  send the unlock message, then poll read-only: one frame every 200 ms
//   end     when the link drops or the user stops. PASS needs 60 s connected AND valid replies.

import { useSyncExternalStore } from 'react';
import { ble } from './manager';
import { POLLS, QUESTIONS, Reassembler, buildMessage, candidateFromReply, decodeSpeed, hex, parseMessage, pollMessage, pollValues, unlockMessage, type Parsed } from './ifit';
import { getCal } from './speedcal';
import { getSettings } from '../lib/settings';
import { clockTime } from './packet';

export type Phase = 'off' | 'armed' | 'questions' | 'waiting' | 'unlock' | 'polling' | 'stopped' | 'ended';
export type StepStatus = 'pending' | 'sending' | 'answered' | 'no reply' | 'error';
export type Source = 'test' | 'check' | 'live';

export interface StepResult { id: string; label: string; status: StepStatus; ms: number | null; reply: string | null; note: string | null }

export interface TestState {
  source: Source;
  armed: boolean;
  allowUnlock: boolean;
  phase: Phase;
  connectedAt: number | null;
  endedAt: number | null;
  steps: StepResult[];
  unlock: StepResult;
  /** Whole request messages sent (questions, unlock, polls). */
  requests: number;
  pollsSent: number;
  keepAliveAsks: number;
  notifications: number;
  /** Whole, well-formed reply messages received. */
  replies: number;
  malformed: number;
  checksumOk: number;
  checksumBad: number;
  /** Replies to read-only polls: the "telemetry" this test is looking for. */
  telemetryReplies: number;
  lastTelemetryAt: number | null;
  pollVariant: string | null;
  lastReplyHex: string | null;
  /** UNVERIFIED candidate values from the latest poll reply. Never used outside the Lab. */
  candidate: { status: number; speedRaw: number; inclineRaw: number } | null;
  /** Value bytes of the latest poll reply (after the status byte). The speed check records these. */
  lastValues: number[] | null;
  /** Belt speed in km/h. Only ever set from a position verified by the speed check; otherwise null. */
  speedKmh: number | null;
  /** Set when the test reached 60 s connected with fresh telemetry replies. */
  passedAt: number | null;
  verdict: string | null;
  lastDisconnect: string | null;
  error: string | null;
}

const blankStep = (id: string, label: string): StepResult => ({ id, label, status: 'pending', ms: null, reply: null, note: null });
const fresh = (armed: boolean, allowUnlock: boolean, source: Source = 'test'): TestState => ({
  source, armed, allowUnlock, phase: armed ? 'armed' : 'off', connectedAt: null, endedAt: null,
  steps: QUESTIONS.map((q) => blankStep(q.id, q.label)), unlock: blankStep('unlock', 'Unlock message 0x90'),
  requests: 0, pollsSent: 0, keepAliveAsks: 0, notifications: 0, replies: 0, malformed: 0, checksumOk: 0, checksumBad: 0,
  telemetryReplies: 0, lastTelemetryAt: null, pollVariant: null, lastReplyHex: null, candidate: null, lastValues: null, speedKmh: null,
  passedAt: null, verdict: null, lastDisconnect: null, error: null,
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const PASS_SECONDS = 60;
const INIT_FRAME_GAP = 450; // the reference wrote start-up frames 400 to 600 ms apart
const POLL_TICK = 200; // one frame per 200 ms, as the reference does

class IfitTest {
  private state: TestState = fresh(false, false);
  private listeners = new Set<() => void>();
  private asm = new Reassembler();
  private waiter: ((p: Parsed, raw: number[]) => void) | null = null;
  private running = false;
  private stopFlag = false;
  private unlockNow = false;
  private runId = 0;
  private prevStatus = '';
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** For the speed check: how many different values each position has shown (a measured speed ramps, a target jumps). */
  private distinct = new Map<number, Set<number>>();
  /** Log every frame of the telemetry link (off by default: it is about 10 lines a second). */
  verboseLive = false;
  private wake: { release: () => Promise<void> } | null = null;

  /** Keeps the screen on while the session runs: a dimmed or hidden page slows the polling and the link drops. */
  private async keepAwake(on: boolean) {
    try {
      if (on && !this.wake && 'wakeLock' in navigator) this.wake = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen');
      if (!on && this.wake) { const w = this.wake; this.wake = null; await w.release(); }
    } catch { this.wake = null; }
  }

  constructor() {
    ble.onPacket((bytes, kind) => { if (kind === 'notify') this.onFrame(bytes); });
    ble.subscribe(() => this.onBle());
    // The browser drops the screen lock whenever the page is hidden; take it again when it comes back.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden && this.running) { this.wake = null; void this.keepAwake(true); } });
  }

  /** How many different 16-bit values position `offset` has shown during this session. */
  variation(offset: number) { return this.distinct.get(offset)?.size ?? 0; }
  isRunning() { return this.running; }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getState = () => this.state;
  private set(patch: Partial<TestState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); }

  /** Step 1 permission. Arms the test for the next connection (or starts now if already connected). */
  arm(on: boolean) {
    if (this.running) return;
    this.state = fresh(on, on && this.state.allowUnlock, 'test');
    this.set({});
    if (on && ble.getState().status === 'connected') void this.run();
  }

  /**
   * Starts the session for the speed check ('check') or as the telemetry link ('live').
   * No two-step wait: the unlock was accepted by this treadmill in the stability test.
   * Runs now if connected, otherwise on the next connection.
   */
  startSession(source: 'check' | 'live') {
    if (this.running) return;
    this.state = fresh(true, true, source);
    this.set({});
    if (ble.getState().status === 'connected') void this.run();
  }

  /** Step 2 permission: the unlock message and the read-only poll. Can be given before or during a run. */
  allowUnlock(on: boolean) {
    this.set({ allowUnlock: on });
    if (this.running) ble.setExperimental(true, on);
  }

  /** Tapped while the test is waiting after step 1. */
  sendUnlockNow() { if (this.state.phase === 'waiting' && this.state.allowUnlock) this.unlockNow = true; }

  /** Stops sending. The mode goes back to read-only; the link is left to the treadmill. */
  stop() {
    if (!this.running) { if (this.state.armed && this.state.phase === 'armed') this.arm(false); return; }
    this.stopFlag = true;
  }

  // ---- incoming ---------------------------------------------------------
  private onFrame(bytes: number[]) {
    if (!this.running) return;
    const st = this.state;
    const r = this.asm.push(bytes);
    const patch: Partial<TestState> = { notifications: st.notifications + 1 };
    if (r === 'unknown') {
      patch.malformed = st.malformed + 1;
    } else if (r) {
      const p = parseMessage(r.message);
      const good = r.complete && p.headerOk && p.lengthOk && p.dir === 'response';
      if (!good) {
        patch.malformed = st.malformed + 1;
        ble.note('warn', `Reply could not be read as an iFit message (${r.message.length} bytes): ${hex(r.message)}`);
      } else {
        patch.replies = st.replies + 1;
        patch.lastReplyHex = hex(r.message);
        if (p.checksumOk) patch.checksumOk = st.checksumOk + 1; else patch.checksumBad = st.checksumBad + 1;
        if (!this.quiet()) ble.note('info', `Reply from console: command 0x${p.cmd.toString(16).padStart(2, '0')}, ${r.message.length} bytes, checksum ${p.checksumOk ? 'ok' : 'DOES NOT MATCH'}: ${hex(r.message)}`);
        if (p.cmd === 0x02) {
          patch.telemetryReplies = st.telemetryReplies + 1;
          patch.candidate = candidateFromReply(p);
          const values = pollValues(p);
          if (values) {
            patch.lastTelemetryAt = Date.now();
            patch.lastValues = values;
            const cal = getCal();
            patch.speedKmh = cal ? decodeSpeed(values, cal) : null;
            if (st.source !== 'live') for (let o = 0; o + 1 < values.length; o++) {
              let set = this.distinct.get(o); if (!set) { set = new Set(); this.distinct.set(o, set); }
              if (set.size < 400) set.add(values[o] | (values[o + 1] << 8));
            }
          }
        }
        const w = this.waiter;
        if (w) { this.waiter = null; w(p, r.message); }
      }
    }
    this.set(patch);
  }

  private ask(message: number[], gap: number, label: string, waitMs: number): Promise<{ p: Parsed; raw: number[]; ms: number } | null> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      let timer: ReturnType<typeof setTimeout> | null = null;
      this.waiter = (p, raw) => { if (timer) clearTimeout(timer); resolve({ p, raw, ms: Date.now() - t0 }); };
      this.set({ requests: this.state.requests + 1 });
      ble.sendIfit(message, gap, label).then(
        () => { timer = setTimeout(() => { this.waiter = null; resolve(null); }, waitMs); },
        (e) => { this.waiter = null; reject(e); },
      );
    });
  }

  private quiet() { return this.state.source === 'live' && !this.verboseLive; }

  private alive(id: number) { return this.running && id === this.runId && !this.stopFlag && ble.getState().status === 'connected'; }

  // ---- the run ----------------------------------------------------------
  private async run() {
    if (this.running || !this.state.armed) return;
    const id = ++this.runId;
    this.running = true; this.stopFlag = false; this.unlockNow = false; this.asm.reset(); this.waiter = null;
    const allow = this.state.allowUnlock, source = this.state.source;
    this.state = { ...fresh(true, allow, source), connectedAt: ble.getState().connectedAt ?? Date.now(), phase: 'questions' };
    this.distinct.clear();
    this.set({});
    if (!ble.setExperimental(true, allow)) { this.finish('Could not start: not connected.'); return; }
    ble.reconnectAfterTx = source === 'live';
    ble.note('info', source === 'live' ? 'TELEMETRY LINK: start-up handshake, then read-only polls (frames are not logged one by one).' : 'TEST step 1: asking the six start-up questions. They carry no values.');
    ble.setQuiet(this.quiet());
    void this.keepAwake(true);
    if (this.watchdog) clearInterval(this.watchdog);
    // Speed is dropped as soon as replies stop for 3 s, even if a write is hanging.
    this.watchdog = setInterval(() => {
      const st = this.state;
      if (st.speedKmh !== null && (st.lastTelemetryAt === null || Date.now() - st.lastTelemetryAt > 3000)) this.set({ speedKmh: null });
    }, 1000);
    try {
      // step 1
      for (let i = 0; i < QUESTIONS.length && this.alive(id); i++) {
        const q = QUESTIONS[i];
        this.patchStep(i, { status: 'sending' });
        const r = await this.ask(buildMessage(q.equip, q.cmd, q.payload), INIT_FRAME_GAP, q.label, 800);
        this.patchStep(i, r ? { status: 'answered', ms: r.ms, reply: hex(r.raw), note: r.p.cmd === q.cmd ? null : `reply names command 0x${r.p.cmd.toString(16)}` } : { status: 'no reply' });
        if (this.alive(id)) await sleep(INIT_FRAME_GAP);
      }
      if (!this.alive(id)) return;
      const answered = this.state.steps.filter((x) => x.status === 'answered').length;
      ble.note(answered ? 'info' : 'warn', `TEST step 1 done: the console answered ${answered} of ${QUESTIONS.length} questions.`);

      // wait for the step 2 permission. With no replies at all, never continue without a tap.
      const auto = this.state.allowUnlock && answered > 0;
      if (!auto && source !== 'test') {
        // The speed check and the telemetry link never wait: no answers means this is not the console we verified.
        this.set({ error: 'The console did not answer the start-up questions, so nothing more was sent.' });
        ble.note('warn', 'Session stopped: the console did not answer the start-up questions. The unlock was not sent.');
        return;
      }
      if (!auto) {
        this.set({ phase: 'waiting' });
        ble.note('info', answered ? 'TEST waiting for your step 2 permission. Asking question 1 every 3 s meanwhile.' : 'TEST: no replies, so the unlock message is NOT sent automatically. Asking question 1 every 3 s meanwhile.');
        const q = QUESTIONS[0];
        while (this.alive(id) && !this.unlockNow) {
          for (let k = 0; k < 30 && this.alive(id) && !this.unlockNow; k++) await sleep(100);
          if (!this.alive(id) || this.unlockNow) break;
          await this.ask(buildMessage(q.equip, q.cmd, q.payload), INIT_FRAME_GAP, 'keep-alive question', 1200);
          this.set({ keepAliveAsks: this.state.keepAliveAsks + 1 });
        }
        if (!this.alive(id)) return;
      }

      // step 2: unlock
      ble.setExperimental(true, true);
      this.set({ phase: 'unlock', unlock: { ...this.state.unlock, status: 'sending' } });
      ble.note(source === 'test' ? 'warn' : 'info', source === 'test' ? 'TEST step 2: sending the unlock message.' : 'Sending the unlock message.');
      const u = await this.ask(unlockMessage(), INIT_FRAME_GAP, 'unlock', 2000);
      this.set({ unlock: { ...this.state.unlock, ...(u ? { status: 'answered', ms: u.ms, reply: hex(u.raw) } : { status: 'no reply' }) } });
      if (!this.alive(id)) return;
      await sleep(INIT_FRAME_GAP);

      // read-only polling, one frame per tick
      this.set({ phase: 'polling' });
      let variant = 0, sentOnVariant = 0, repliesAtSwitch = this.state.telemetryReplies, triedAll = false;
      this.set({ pollVariant: `${POLLS[0].id}: ${POLLS[0].label}` });
      ble.note('info', `Polling (read-only) with poll ${POLLS[0].id}: ${POLLS[0].label}. One frame every ${POLL_TICK} ms.`);
      while (this.alive(id)) {
        const t0 = Date.now();
        // A hidden page gets its timers slowed to one a second, so skip the gaps between frames there.
        const gap = typeof document !== 'undefined' && document.hidden ? 0 : POLL_TICK;
        await ble.sendIfit(pollMessage(POLLS[variant].read), gap, `poll ${POLLS[variant].id}`);
        sentOnVariant++;
        this.set({ requests: this.state.requests + 1, pollsSent: this.state.pollsSent + 1 });
        const wait = POLL_TICK - ((Date.now() - t0) % POLL_TICK);
        await sleep(Math.max(40, Math.min(POLL_TICK, wait)));
        // No reply to 8 polls in a row on this variant: try the next read list (all are read-only).
        if (!triedAll && sentOnVariant >= 8 && this.state.telemetryReplies === repliesAtSwitch) {
          if (variant < POLLS.length - 1) {
            variant++; sentOnVariant = 0; repliesAtSwitch = this.state.telemetryReplies;
            this.set({ pollVariant: `${POLLS[variant].id}: ${POLLS[variant].label}` });
            ble.note('warn', `TEST: no reply to the previous poll. Switching to poll ${POLLS[variant].id}: ${POLLS[variant].label}.`);
          } else { triedAll = true; ble.note('warn', 'TEST: none of the three read-only polls got a reply. Continuing with the last one to see how long the link holds.'); }
        }
        this.checkPass();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (ble.getState().status === 'connected') { this.set({ error: msg }); ble.note('error', `TEST stopped: ${msg}`); }
    } finally {
      if (id === this.runId) this.finish(null);
    }
  }

  private patchStep(i: number, patch: Partial<StepResult>) {
    const steps = this.state.steps.slice(); steps[i] = { ...steps[i], ...patch }; this.set({ steps });
  }

  private checkPass() {
    const s = this.state;
    if (s.passedAt || !s.connectedAt) return;
    const now = Date.now();
    if (now - s.connectedAt >= PASS_SECONDS * 1000 && s.telemetryReplies >= 20 && s.lastTelemetryAt !== null && now - s.lastTelemetryAt < 3000) {
      this.set({ passedAt: now });
      ble.note('info', `TEST PASSED the ${PASS_SECONDS}-second target: still connected with ${s.telemetryReplies} poll replies. Keeps running until you stop it.`);
    }
  }

  private finish(reason: string | null) {
    if (!this.running) return;
    this.running = false;
    const s = this.state, now = Date.now();
    const connected = ble.getState().status === 'connected';
    const secs = s.connectedAt ? (now - s.connectedAt) / 1000 : 0;
    const answered = s.steps.filter((x) => x.status === 'answered').length;
    let verdict: string;
    if (reason) verdict = reason;
    else if (s.passedAt) verdict = `PASS: connected ${secs.toFixed(0)} s with ${s.telemetryReplies} replies to read-only polls. Speed is still NOT verified: compare the candidate value with the console next.`;
    else if (s.telemetryReplies > 0) verdict = `Partly working: ${s.telemetryReplies} poll replies, but the link lasted ${secs.toFixed(1)} s, short of ${PASS_SECONDS} s${this.stopFlag ? ' (you stopped it)' : ''}.`;
    else if (s.replies > 0) verdict = `The console answered (${answered} of ${QUESTIONS.length} questions${s.unlock.status === 'answered' ? ', and the unlock' : ''}) but sent no telemetry. Link lasted ${secs.toFixed(1)} s.`;
    else verdict = `No valid reply from the console. Link lasted ${secs.toFixed(1)} s. ${s.requests} requests were sent.`;
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    void this.keepAwake(false);
    if (s.source !== 'test' && !reason) verdict = `${s.source === 'live' ? 'Telemetry link' : 'Speed check session'} ended after ${secs.toFixed(0)} s: ${s.telemetryReplies} poll replies${s.error ? `. ${s.error}` : this.stopFlag ? ' (you stopped it)' : ''}.`;
    if (connected) ble.setExperimental(false);
    ble.setQuiet(false);
    this.set({ phase: this.stopFlag && connected ? 'stopped' : 'ended', endedAt: now, verdict, armed: false, speedKmh: null, lastDisconnect: connected ? null : ble.getState().lastDisconnect });
    ble.note('info', `${s.source === 'test' ? 'TEST RESULT' : 'SESSION'}: ${verdict}`);
  }

  private onBle() {
    const b = ble.getState();
    const justConnected = b.status === 'connected' && this.prevStatus !== 'connected';
    this.prevStatus = b.status;
    if (b.status === 'connected' && this.state.armed && !this.running && this.state.phase === 'armed') void this.run();
    else if (justConnected && !this.running && getSettings().telemetryLink && getCal()) this.startSession('live'); // telemetry link: only with a verified speed position
    else if (b.status !== 'connected' && this.running) {
      // the run loop notices on its next step; make sure a waiting ask is released
      this.waiter = null;
      this.finish(null);
      this.runId++;
    }
  }

  // ---- report -------------------------------------------------------------
  reportText() {
    const s = this.state, b = ble.getState();
    const dur = s.connectedAt ? (((s.endedAt ?? Date.now()) - s.connectedAt) / 1000).toFixed(1) + ' s' : '-';
    const c = s.candidate;
    const lines = [
      `ProForm Smart Control: iFit telemetry report (${s.source === 'test' ? 'stability test' : s.source === 'check' ? 'speed check session' : 'telemetry link'})`,
      `Exported: ${new Date().toISOString()}`,
      `Device: ${b.deviceName ?? '-'} · Browser: ${navigator.userAgent}`,
      '',
      `Result: ${s.verdict ?? '(test not finished)'}`,
      `Connection duration: ${dur}${s.connectedAt ? ` (connected ${clockTime(s.connectedAt)})` : ''}`,
      `Service 1533 found: ${b.serviceFound ? 'yes' : 'no'} · Notifications on 1535: ${b.notifying ? 'enabled' : s.endedAt ? 'were enabled until the link closed' : 'off'}`,
      `Step 2 (unlock) allowed: ${s.allowUnlock ? 'yes' : 'no'}`,
      '',
      'Initialization progress:',
      ...s.steps.map((x, i) => `  ${i + 1}. ${x.label}: ${x.status}${x.ms !== null ? ` in ${x.ms} ms` : ''}${x.note ? ` (${x.note})` : ''}${x.reply ? `\n     reply: ${x.reply}` : ''}`),
      `  7. ${s.unlock.label}: ${s.unlock.status}${s.unlock.ms !== null ? ` in ${s.unlock.ms} ms` : ''}${s.unlock.reply ? `\n     reply: ${s.unlock.reply}` : ''}`,
      '',
      `Requests sent: ${s.requests} (polls ${s.pollsSent}, keep-alive questions ${s.keepAliveAsks}) · frames written: ${b.txFrames}`,
      `Notifications received: ${s.notifications} · whole replies: ${s.replies} · unreadable: ${s.malformed}`,
      `Reply checksums: ${s.checksumOk} ok, ${s.checksumBad} not matching`,
      `Poll replies (telemetry): ${s.telemetryReplies} · poll in use: ${s.pollVariant ?? '-'}`,
      getCal()
        ? `Decoded speed: VERIFIED position ${getCal()!.offset}, divide by ${getCal()!.scale}, ${getCal()!.rawUnit === 'kmh' ? 'km/h' : 'mph'}. Now: ${s.speedKmh === null ? 'no fresh reading' : s.speedKmh.toFixed(2) + ' km/h'}`
        : `Decoded speed: NOT VERIFIED. Candidate from last poll reply: ${c ? `status 0x${c.status.toString(16)}, first value ${c.speedRaw} (= ${(c.speedRaw / 100).toFixed(2)} if hundredths), second value ${c.inclineRaw}` : 'none'}`,
      `Last poll reply values: ${s.lastValues ? hex(s.lastValues) : '-'}`,
      `Last reply: ${s.lastReplyHex ?? '-'}`,
      `Last disconnect: ${s.lastDisconnect ?? b.lastDisconnect ?? '-'}`,
      s.error ? `Error: ${s.error}` : '',
      '',
      '---- full timestamped log ----',
      ble.exportText(),
    ];
    return lines.join('\n');
  }
}

export const ifitTest = new IfitTest();
export const useIfitTest = () => useSyncExternalStore(ifitTest.subscribe, ifitTest.getState);
