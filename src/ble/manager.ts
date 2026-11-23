// Real Web Bluetooth connection manager for the treadmill.
//
// READ-ONLY BY DEFAULT. In normal use the only things sent to the treadmill are
// what the browser does itself for connect, service discovery, reads and enabling
// notifications.
//
// Experimental iFit Telemetry Mode (Bluetooth Lab only, switched on by the user for
// one connection at a time) adds exactly ONE write path: sendIfit() below. It runs
// every message through assertSafeRequest() in ./ifit, which only lets through the
// start-up questions, the unlock message (step 2 permission) and pure reads. It
// refuses any message that would set a value, so speed, incline and start cannot be
// sent. The firmware-update service is never requested, so the browser blocks it.

import { CHAR_1534, CHAR_1535, DEVICE_NAME, IFIT_SERVICE, UNKNOWN_SERVICE, shortUuid } from './constants';
import { clockTime, toHex } from './packet';
import { assertSafeRequest, toFrames } from './ifit';
import { saveBleSession } from '../db/db';

export type Support = 'ok' | 'no-api' | 'insecure' | 'adapter-off';
export type Status = 'idle' | 'choosing' | 'connecting' | 'discovering' | 'connected' | 'disconnected' | 'error';
export type LogKind = 'info' | 'warn' | 'error' | 'notify' | 'read' | 'tx';
export type Mode = 'read-only' | 'experimental';

export interface LogEntry {
  id: number;
  t: number;
  kind: LogKind;
  msg: string;
  char?: string;
  bytes?: number[];
}

export interface CharInfo {
  uuid: string;
  short: string;
  service: string;
  read: boolean;
  write: boolean;
  writeNoResp: boolean;
  notify: boolean;
  indicate: boolean;
}

export interface SessionSummary {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  packets: number;
  userEnded: boolean;
}

export interface BleState {
  support: Support;
  status: Status;
  deviceName: string | null;
  deviceId: string | null;
  serviceFound: boolean;
  unknownServiceFound: boolean;
  chars: CharInfo[];
  notifying: boolean;
  connectedAt: number | null;
  lastPacketAt: number | null;
  sessionPackets: number;
  lastError: string | null;
  lastDisconnect: string | null;
  sessions: SessionSummary[];
  autoReconnect: boolean;
  reconnectAttempt: number;
  logVersion: number;
  /** 'experimental' only while the user has switched on Experimental iFit Telemetry Mode for this connection. */
  mode: Mode;
  /** Frames written to 1534 on this connection. Always 0 in read-only mode. */
  txFrames: number;
}

const MAX_LOG = 4000;
const MAX_RECONNECTS = 5;

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

class BleManager {
  private state: BleState = {
    support: 'ok',
    status: 'idle',
    deviceName: null,
    deviceId: null,
    serviceFound: false,
    unknownServiceFound: false,
    chars: [],
    notifying: false,
    connectedAt: null,
    lastPacketAt: null,
    sessionPackets: 0,
    lastError: null,
    lastDisconnect: null,
    sessions: [],
    autoReconnect: false,
    reconnectAttempt: 0,
    logVersion: 0,
    mode: 'read-only',
    txFrames: 0,
  };
  private listeners = new Set<() => void>();
  private log: LogEntry[] = [];
  private nextId = 1;
  private device: BluetoothDevice | null = null;
  private chars = new Map<string, BluetoothRemoteGATTCharacteristic>();
  private pendingRead: string | null = null;
  private pendingReadLogged = false;
  private userEnded = false;
  private sessionLogStart = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyPending = false;
  /** One GATT operation at a time: reads and writes wait their turn here. */
  private gattChain: Promise<unknown> = Promise.resolve();
  private packetListeners = new Set<(bytes: number[], kind: 'read' | 'notify') => void>();
  private allowUnlock = false;
  private quiet = false;
  /** Set by the telemetry link (speed verified): lets auto-reconnect work after a connection that sent frames. */
  reconnectAfterTx = false;

  constructor() {
    this.state.support = this.detectSupport();
    try {
      this.state.autoReconnect = localStorage.getItem('psc.autoReconnect') === '1';
    } catch { /* storage blocked */ }
  }

  // ---- store plumbing -------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getState = () => this.state;
  getLog = () => this.log;

  private set(patch: Partial<BleState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /** Packets can arrive quickly, so UI updates for them are batched per frame. */
  private bumpLogSoon() {
    if (this.notifyPending) return;
    this.notifyPending = true;
    const run = () => {
      this.notifyPending = false;
      this.set({ logVersion: this.state.logVersion + 1 });
    };
    if (typeof requestAnimationFrame === 'function' && document.visibilityState === 'visible') requestAnimationFrame(run);
    else setTimeout(run, 100);
  }

  /** Quiet = do not log every frame (used by the always-on telemetry link, about 10 frames a second). Counters still run. */
  setQuiet(on: boolean) { this.quiet = on; }

  /** Lets the experimental test write its own lines into the same timestamped log. */
  note(kind: 'info' | 'warn' | 'error', msg: string) { this.add(kind, msg); }

  /** Calls `fn` for every packet from the treadmill (the 1535 channel). Returns an unsubscribe function. */
  onPacket(fn: (bytes: number[], kind: 'read' | 'notify') => void) {
    this.packetListeners.add(fn);
    return () => { this.packetListeners.delete(fn); };
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.gattChain.then(job, job);
    this.gattChain = run.catch(() => undefined);
    return run;
  }

  private add(kind: LogKind, msg: string, extra?: { char?: string; bytes?: number[] }) {
    this.log.push({ id: this.nextId++, t: Date.now(), kind, msg, ...extra });
    if (this.log.length > MAX_LOG) {
      const cut = this.log.length - MAX_LOG;
      this.log.splice(0, cut);
      this.sessionLogStart = Math.max(0, this.sessionLogStart - cut);
    }
    this.bumpLogSoon();
  }

  // ---- support --------------------------------------------------------
  private detectSupport(): Support {
    if (typeof window === 'undefined') return 'no-api';
    if (!window.isSecureContext) return 'insecure';
    if (!navigator.bluetooth) return 'no-api';
    return 'ok';
  }

  async refreshSupport() {
    let support = this.detectSupport();
    if (support === 'ok' && navigator.bluetooth?.getAvailability) {
      try {
        if (!(await navigator.bluetooth.getAvailability())) support = 'adapter-off';
      } catch { /* treat as available */ }
    }
    if (support !== this.state.support) this.set({ support });
    return support;
  }

  setAutoReconnect(on: boolean) {
    try { localStorage.setItem('psc.autoReconnect', on ? '1' : '0'); } catch { /* ignore */ }
    if (!on) this.cancelReconnect();
    this.set({ autoReconnect: on, reconnectAttempt: on ? this.state.reconnectAttempt : 0 });
  }

  // ---- connect --------------------------------------------------------
  /**
   * Must be called from a tap. Opens the browser's own device chooser.
   * `anyDevice` lists every nearby BLE device, for when the name filter finds nothing.
   */
  async connect(anyDevice = false) {
    const support = await this.refreshSupport();
    if (support !== 'ok') {
      this.set({ status: 'error', lastError: 'Bluetooth is not available in this browser.' });
      return;
    }
    if (['choosing', 'connecting', 'discovering'].includes(this.state.status)) return;
    this.cancelReconnect();
    if (this.device?.gatt?.connected) this.disconnect();

    this.set({ status: 'choosing', lastError: null, reconnectAttempt: 0 });
    this.add('info', anyDevice ? 'Opening device chooser (all nearby devices)' : `Opening device chooser (filter: name "${DEVICE_NAME}")`);
    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth!.requestDevice(
        anyDevice
          ? { acceptAllDevices: true, optionalServices: [IFIT_SERVICE, UNKNOWN_SERVICE] }
          : { filters: [{ name: DEVICE_NAME }], optionalServices: [IFIT_SERVICE, UNKNOWN_SERVICE] },
      );
    } catch (e) {
      const cancelled = e instanceof Error && e.name === 'NotFoundError';
      this.add(cancelled ? 'info' : 'error', cancelled ? 'Chooser closed without picking a device' : `Chooser failed: ${errText(e)}`);
      this.set({
        status: this.state.deviceName ? 'disconnected' : 'idle',
        lastError: cancelled ? null : errText(e),
      });
      return;
    }

    if (this.device && this.device !== device) this.device.removeEventListener('gattserverdisconnected', this.onDisconnected);
    this.device = device;
    device.addEventListener('gattserverdisconnected', this.onDisconnected);
    this.add('info', `Selected "${device.name ?? '(no name)'}", browser id ${device.id}`);
    this.set({ deviceName: device.name ?? '(no name)', deviceId: device.id });
    await this.openGatt();
  }

  /** Re-opens the link to the device already chosen. No chooser, nothing written. */
  async reconnect() {
    if (!this.device) return this.connect();
    if (['choosing', 'connecting', 'discovering', 'connected'].includes(this.state.status)) return;
    this.cancelReconnect();
    this.set({ lastError: null });
    await this.openGatt();
  }

  private async openGatt() {
    const device = this.device;
    if (!device?.gatt) {
      this.set({ status: 'error', lastError: 'This device does not offer GATT.' });
      return;
    }
    this.userEnded = false;
    this.chars.clear();
    this.allowUnlock = false;
    this.gattChain = Promise.resolve();
    this.set({ status: 'connecting', serviceFound: false, unknownServiceFound: false, chars: [], notifying: false, mode: 'read-only', txFrames: 0 });
    try {
      this.add('info', 'Connecting to GATT server…');
      const server = await withTimeout(device.gatt.connect(), 20000, 'GATT connect');
      const connectedAt = Date.now();
      this.sessionLogStart = Math.max(0, this.log.length - 1);
      this.set({ status: 'discovering', connectedAt, sessionPackets: 0, lastPacketAt: null });
      this.add('info', 'Connected. Discovering services…');

      const service = await server.getPrimaryService(IFIT_SERVICE);
      this.add('info', `Service ${shortUuid(IFIT_SERVICE)} found (${IFIT_SERVICE})`);
      const found = await service.getCharacteristics();
      const infos: CharInfo[] = found.map((c) => this.describe(c, IFIT_SERVICE));
      for (const c of found) this.chars.set(c.uuid.toLowerCase(), c);
      for (const i of infos) this.add('info', `Characteristic ${i.short}: ${propsText(i)}`);
      this.set({ serviceFound: true, chars: infos });

      // The unknown service is only listed so its layout shows up in the log.
      try {
        const other = await server.getPrimaryService(UNKNOWN_SERVICE);
        const otherChars = await other.getCharacteristics();
        const otherInfos = otherChars.map((c) => this.describe(c, UNKNOWN_SERVICE));
        for (const i of otherInfos) this.add('info', `Unknown service ${shortUuid(UNKNOWN_SERVICE)} characteristic ${i.short}: ${propsText(i)} (listed only)`);
        this.set({ unknownServiceFound: true, chars: [...infos, ...otherInfos] });
      } catch (e) {
        this.add('info', `Unknown service ${shortUuid(UNKNOWN_SERVICE)} not listed: ${errText(e)}`);
      }

      const c1535 = this.chars.get(CHAR_1535);
      const c1534 = this.chars.get(CHAR_1534);
      if (!c1535) this.add('warn', 'Characteristic 1535 not found on this device');
      if (!c1534) this.add('warn', 'Characteristic 1534 not found on this device');

      if (c1535) {
        c1535.addEventListener('characteristicvaluechanged', this.onValue);
        if (c1535.properties.notify || c1535.properties.indicate) {
          await c1535.startNotifications();
          this.add('info', 'Notifications enabled on 1535');
          this.set({ notifying: true });
        }
      }
      if (!device.gatt.connected) throw new Error('Treadmill closed the link during setup');
      this.set({ status: 'connected', reconnectAttempt: 0 });
      this.add('info', this.state.mode === 'experimental' ? 'Ready. The experimental test has started on this connection.' : 'Ready. Listening in read-only mode; nothing is being sent to the treadmill.');
      if (c1535?.properties.read) await this.read('1535');
    } catch (e) {
      this.add('error', `Connection failed: ${errText(e)}`);
      const wasLive = this.state.connectedAt !== null && device.gatt.connected;
      if (wasLive) {
        this.userEnded = true; // closing a half-open link ourselves
        try { device.gatt.disconnect(); } catch { /* already gone */ }
      }
      if (this.state.status !== 'disconnected') {
        this.set({ status: 'error', lastError: errText(e), connectedAt: null, notifying: false });
      } else {
        this.set({ lastError: errText(e) });
      }
    }
  }

  private describe(c: BluetoothRemoteGATTCharacteristic, service: string): CharInfo {
    const p = c.properties;
    return {
      uuid: c.uuid,
      short: shortUuid(c.uuid),
      service,
      read: p.read,
      write: p.write,
      writeNoResp: p.writeWithoutResponse,
      notify: p.notify,
      indicate: p.indicate,
    };
  }

  // ---- data in --------------------------------------------------------
  private onValue = (ev: Event) => {
    const c = ev.target as BluetoothRemoteGATTCharacteristic;
    const v = c.value;
    if (!v) return;
    const bytes = Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    const short = shortUuid(c.uuid);
    // The browser fires this same event for a read result and for a notification.
    const isRead = this.pendingRead === c.uuid.toLowerCase() && !this.pendingReadLogged;
    if (isRead) this.pendingReadLogged = true;
    this.packet(isRead ? 'read' : 'notify', short, bytes);
    if (short === '1535') this.packetListeners.forEach((fn) => { try { fn(bytes, isRead ? 'read' : 'notify'); } catch { /* a listener must not break the link */ } });
  };

  private packet(kind: 'read' | 'notify', short: string, bytes: number[]) {
    if (!(this.quiet && kind === 'notify')) this.add(kind, `${kind === 'read' ? 'Read' : 'Notification'} from ${short}, ${bytes.length} bytes: ${toHex(bytes)}`, { char: short, bytes });
    this.state = { ...this.state, lastPacketAt: Date.now(), sessionPackets: this.state.sessionPackets + 1 };
  }

  /** Reads 1534 or 1535 once. A read asks for the current value; it is not a command. */
  async read(which: '1534' | '1535') {
    const uuid = which === '1534' ? CHAR_1534 : CHAR_1535;
    const c = this.chars.get(uuid);
    if (!c || this.state.status !== 'connected') {
      this.add('warn', `Cannot read ${which}: not connected`);
      return;
    }
    if (!c.properties.read) {
      this.add('warn', `Characteristic ${which} does not allow reads`);
      return;
    }
    if (this.pendingRead) return;
    this.pendingRead = uuid;
    this.pendingReadLogged = false;
    try {
      const v = await this.enqueue(() => withTimeout(c.readValue(), 8000, `Read ${which}`));
      if (!this.pendingReadLogged) {
        this.packet('read', which, Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)));
      }
    } catch (e) {
      this.add('error', `Read ${which} failed: ${errText(e)}`);
    } finally {
      this.pendingRead = null;
    }
  }

  // ---- experimental iFit telemetry mode ---------------------------------
  /**
   * Switches Experimental iFit Telemetry Mode on or off for the current connection.
   * It always starts off, and goes back to off on every disconnect.
   * `allowUnlock` is the separate step 2 permission (the unlock message).
   */
  setExperimental(on: boolean, allowUnlock = false) {
    if (on && this.state.status !== 'connected') return false;
    this.allowUnlock = on && allowUnlock;
    if (on && this.state.mode !== 'experimental') this.add('warn', 'EXPERIMENTAL iFit Telemetry Mode ON for this connection. Only start-up questions, the unlock message (if allowed) and read-only polls can be sent.');
    if (!on && this.state.mode === 'experimental') this.add('info', 'Experimental iFit Telemetry Mode OFF. Back to read-only: nothing more is sent.');
    this.set({ mode: on ? 'experimental' : 'read-only' });
    return true;
  }

  /**
   * The ONLY place this app writes to the treadmill. Sends one iFit message to 1534 as frames,
   * one at a time, each acknowledged by the treadmill (write with response) before the next.
   * Throws if the mode is off, the link is down, or the guard refuses the message.
   */
  async sendIfit(message: number[], frameGapMs: number, label: string): Promise<void> {
    if (this.state.mode !== 'experimental') throw new Error('Refused: Experimental iFit Telemetry Mode is off');
    const c = this.chars.get(CHAR_1534);
    if (!c || this.state.status !== 'connected' || !this.device?.gatt?.connected) throw new Error('Not connected');
    assertSafeRequest(message, this.allowUnlock); // throws on anything that is not a question, the unlock or a pure read
    const withResponse = c.properties.write || !c.properties.writeWithoutResponse;
    const frames = toFrames(message);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const t0 = Date.now();
      await this.enqueue(() => {
        if (this.state.mode !== 'experimental' || !this.device?.gatt?.connected) return Promise.reject(new Error('Link closed before the frame was sent'));
        const data = new Uint8Array(f);
        return withTimeout(withResponse ? c.writeValueWithResponse(data) : c.writeValueWithoutResponse(data), 4000, 'Write to 1534');
      });
      if (!this.quiet) this.add('tx', `Sent to 1534 (${label}, frame ${i + 1}/${frames.length}, acknowledged in ${Date.now() - t0} ms): ${toHex(f)}`, { char: '1534', bytes: f });
      this.state = { ...this.state, txFrames: this.state.txFrames + 1 };
      if (frameGapMs > 0 && i < frames.length - 1) await new Promise((r) => setTimeout(r, frameGapMs));
    }
  }

  // ---- disconnect -----------------------------------------------------
  /** User-requested disconnect: releases the link and stops any reconnect attempts. */
  disconnect() {
    this.cancelReconnect();
    this.userEnded = true;
    const gatt = this.device?.gatt;
    if (gatt?.connected) {
      this.add('info', 'Disconnecting at your request');
      gatt.disconnect(); // fires gattserverdisconnected
    } else if (this.state.status !== 'idle') {
      this.set({ status: 'disconnected', notifying: false, connectedAt: null, reconnectAttempt: 0 });
    }
  }

  private onDisconnected = () => {
    const now = Date.now();
    const started = this.state.connectedAt;
    const durationMs = started ? now - started : 0;
    const userEnded = this.userEnded;
    const packets = this.state.sessionPackets;
    const secs = (durationMs / 1000).toFixed(1);
    const wasExperimental = this.state.mode === 'experimental' || this.state.txFrames > 0;
    this.allowUnlock = false;
    const reason = userEnded
      ? `You disconnected after ${secs}s`
      : `Link lost after ${secs}s with ${packets} packet${packets === 1 ? '' : 's'} received${this.state.txFrames ? ` and ${this.state.txFrames} frames sent` : ''}. The browser does not report who ended it or why.`;
    this.add(userEnded ? 'info' : 'warn', `Disconnected. ${reason}`);

    const c1535 = this.chars.get(CHAR_1535);
    c1535?.removeEventListener('characteristicvaluechanged', this.onValue);
    this.chars.clear();
    this.pendingRead = null;

    const summary: SessionSummary | null = started ? { startedAt: started, endedAt: now, durationMs, packets, userEnded } : null;
    // Status flips to Disconnected in the same tick the browser reports it.
    this.set({
      status: 'disconnected',
      notifying: false,
      connectedAt: null,
      mode: 'read-only',
      lastDisconnect: reason,
      sessions: summary ? [summary, ...this.state.sessions].slice(0, 20) : this.state.sessions,
    });

    if (summary) {
      const entries = this.log.slice(this.sessionLogStart);
      void saveBleSession({
        ...summary,
        deviceName: this.state.deviceName ?? '',
        log: entries,
      }).catch(() => { /* diagnostics are best effort */ });
    }

    // After an experimental test the app never reconnects by itself. The telemetry link (speed verified) may.
    if (!userEnded && (!wasExperimental || this.reconnectAfterTx) && this.state.autoReconnect && this.state.reconnectAttempt < MAX_RECONNECTS) {
      const attempt = this.state.reconnectAttempt + 1;
      const wait = Math.min(2000 * attempt, 8000);
      this.add('info', `Auto-reconnect ${attempt}/${MAX_RECONNECTS} in ${wait / 1000}s`);
      this.set({ reconnectAttempt: attempt });
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.openGatt();
      }, wait);
    }
  };

  private cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ---- log ------------------------------------------------------------
  clearLog() {
    this.log = [];
    this.sessionLogStart = 0;
    this.set({ logVersion: this.state.logVersion + 1 });
  }

  exportText(entries: LogEntry[] = this.log) {
    const s = this.state;
    const head = [
      'ProForm Smart Control: Bluetooth debug log',
      `Exported: ${new Date().toISOString()}`,
      `Device: ${s.deviceName ?? '-'} (browser id ${s.deviceId ?? '-'})`,
      `Browser: ${navigator.userAgent}`,
      `Mode now: ${s.mode === 'experimental' ? 'EXPERIMENTAL iFit telemetry (questions, unlock if allowed, read-only polls)' : 'read-only'}. Lines marked TX are frames this app sent; without TX lines nothing was sent.`,
      '',
    ];
    return head.concat(entries.map(lineOf)).join('\n');
  }

  exportCsv(entries: LogEntry[] = this.log) {
    const rows = ['iso_time,clock,kind,characteristic,length,hex'];
    for (const e of entries) {
      if (!e.bytes) continue;
      rows.push([new Date(e.t).toISOString(), clockTime(e.t), e.kind, e.char ?? '', e.bytes.length, toHex(e.bytes, ' ')].join(','));
    }
    return rows.join('\n');
  }

  exportJson(entries: LogEntry[] = this.log) {
    const s = this.state;
    return JSON.stringify(
      {
        app: 'ProForm Smart Control',
        exportedAt: new Date().toISOString(),
        mode: s.mode,
        framesSentThisConnection: s.txFrames,
        device: { name: s.deviceName, browserId: s.deviceId },
        userAgent: navigator.userAgent,
        characteristics: s.chars,
        sessions: s.sessions,
        log: entries.map((e) => ({ ...e, iso: new Date(e.t).toISOString(), hex: e.bytes ? toHex(e.bytes) : undefined })),
      },
      null,
      2,
    );
  }
}

export const lineOf = (e: LogEntry) => `${clockTime(e.t)}  ${e.kind.toUpperCase().padEnd(6)}  ${e.msg}`;

export const propsText = (i: CharInfo) =>
  [i.read && 'READ', i.write && 'WRITE', i.writeNoResp && 'WRITE NO RESPONSE', i.notify && 'NOTIFY', i.indicate && 'INDICATE']
    .filter(Boolean)
    .join(', ') || 'none';

export const ble = new BleManager();
