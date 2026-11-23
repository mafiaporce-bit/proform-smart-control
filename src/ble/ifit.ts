// iFit BLE message codec and the safety guard for Experimental iFit Telemetry Mode.
//
// Pure functions, no Bluetooth calls, so they can be unit-tested (tools/test-ifit.mjs).
//
// What is known and how:
//  - The frames below come from hms-homelab/nordictrack_t5 (docs/TREADMILL_PROTOCOL.md), a console
//    that also advertises as I_TL with service 1533. NOT yet confirmed on the ProForm 105 CST.
//  - Message layout, worked out from those frames:
//      [02 04 02] [L] [equipment] [L] [command] [payload ...] [checksum]
//    L = bytes from `equipment` to `checksum`. checksum = sum(equipment .. last payload byte) & 0xFF.
//    This checksum rule reproduces the checksum of every start-up message in the reference, and of
//    the poll (F2). The unit test proves that byte for byte.
//  - Command 0x02 payload = [n write-bitmap bytes][bitmap][values][n read-bitmap bytes][bitmap].
//    The reference "set speed" frame has n-write = 1; the reference poll has n-write = 0.
//
// The guard: the app may only transmit
//    (a) the six start-up questions, which carry no values (empty payload, or two zero bytes),
//    (b) the unlock message 0x90, only when the user allowed step 2,
//    (c) command 0x02 with an EMPTY write section (a pure read).
// Anything else is refused before a single byte is written. There is no code in this app that
// builds a message with a write section, so speed, incline and start cannot be sent.

export const FRAME_DATA = 18; // data bytes per 20-byte frame

export type Equip = 0x02 | 0x04;

const sum = (a: number[]) => a.reduce((x, y) => (x + y) & 0xff, 0);
export const hex = (a: number[]) => a.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/** Builds one request message with its lengths and checksum. */
export function buildMessage(equip: number, cmd: number, payload: number[] = []): number[] {
  const L = payload.length + 4;
  const body = [equip, L, cmd, ...payload];
  return [0x02, 0x04, 0x02, L, ...body, sum(body)];
}

/** Splits a message into the frames written to 1534: a 4-byte header, then 20-byte chunks. */
export function toFrames(message: number[]): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < message.length; i += FRAME_DATA) chunks.push(message.slice(i, i + FRAME_DATA));
  const frames: number[][] = [[0xfe, 0x02, message.length, chunks.length + 1]];
  chunks.forEach((c, i) => {
    const f = [i === chunks.length - 1 ? 0xff : i, c.length, ...c];
    while (f.length < 20) f.push(0);
    frames.push(f);
  });
  return frames;
}

export interface Parsed {
  dir: 'request' | 'response' | 'unknown';
  headerOk: boolean;
  lengthOk: boolean;
  checksumOk: boolean;
  equip: number;
  cmd: number;
  payload: number[];
}

export function parseMessage(m: number[]): Parsed {
  const bad: Parsed = { dir: 'unknown', headerOk: false, lengthOk: false, checksumOk: false, equip: -1, cmd: -1, payload: [] };
  if (m.length < 8) return bad;
  const dir = m[0] === 0x02 ? 'request' : m[0] === 0x01 ? 'response' : 'unknown';
  const headerOk = dir !== 'unknown' && m[1] === 0x04 && m[2] === 0x02;
  const L = m[3];
  const lengthOk = L === m[5] && m.length === L + 4;
  const checksumOk = sum(m.slice(4, m.length - 1)) === m[m.length - 1];
  return { dir, headerOk, lengthOk, checksumOk, equip: m[4], cmd: m[6], payload: m.slice(7, m.length - 1) };
}

// ---- what may be sent -------------------------------------------------------

/** Start-up questions, in the reference order. They carry no values. */
export const QUESTIONS: Array<{ id: string; label: string; equip: number; cmd: number; payload: number[] }> = [
  { id: 'q81', label: 'Question 0x81 (general)', equip: 0x02, cmd: 0x81, payload: [] },
  { id: 'q80', label: 'Question 0x80 (treadmill)', equip: 0x04, cmd: 0x80, payload: [] },
  { id: 'q88', label: 'Question 0x88 (treadmill)', equip: 0x04, cmd: 0x88, payload: [] },
  { id: 'q82', label: 'Question 0x82 (general)', equip: 0x02, cmd: 0x82, payload: [0, 0] },
  { id: 'q84', label: 'Question 0x84 (general)', equip: 0x02, cmd: 0x84, payload: [0, 0] },
  { id: 'q95', label: 'Question 0x95 (general)', equip: 0x02, cmd: 0x95, payload: [] },
];

/** The unlock key from the reference console. May be wrong for the 105 CST: that is what step 2 tests. */
const REFERENCE_UNLOCK_KEY = [
  0x04, 0x00, 0x61, 0xd8, 0x5d, 0xd0, 0x51, 0xd0, 0x55, 0xe8, 0x61, 0xf8, 0x8d, 0x00, 0x91, 0x20, 0xd5, 0x48,
  0xe1, 0x98, 0x3d, 0xd0, 0x71, 0x10, 0xb5, 0x48, 0xe1, 0xb8, 0x4d, 0xe0, 0xb1, 0x40, 0x80, 0x02, 0x00, 0x00,
];
export const unlockMessage = () => buildMessage(0x04, 0x90, REFERENCE_UNLOCK_KEY);

/**
 * Read-only polls: command 0x02, empty write section, then a list of values to read.
 *  B  the reference poll. The public write-up lost 4 bytes of it; these 4 are the completion that
 *     makes the captured checksum (F2) come out right.
 *  A  the same poll as the write-up used it (those 4 bytes as zero), with a correct checksum.
 *  C  the smallest possible read: only the first two values (speed and incline on the reference).
 */
export const POLLS: Array<{ id: 'B' | 'A' | 'C'; label: string; read: number[] }> = [
  { id: 'B', label: 'reference poll', read: [0x13, 0x94, 0x33, 0x00, 0x10, 0x40, 0x10, 0x00, 0x80, 0x18] },
  { id: 'A', label: 'reference poll, shortened list', read: [0x13, 0x94, 0x33, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x18] },
  { id: 'C', label: 'minimal poll (first two values)', read: [0x03] },
];
export const pollMessage = (read: number[]) => buildMessage(0x04, 0x02, [0x00, read.length, ...read]);

const QUESTION_CMDS = new Set(QUESTIONS.map((q) => q.cmd));

/**
 * Throws unless `m` is one of the message kinds described at the top of this file.
 * The connection manager calls this on every outgoing message; nothing can be written without it.
 */
export function assertSafeRequest(m: number[], allowUnlock: boolean): void {
  const p = parseMessage(m);
  if (p.dir !== 'request' || !p.headerOk) throw new Error('Refused: not an iFit request message');
  if (!p.lengthOk) throw new Error('Refused: message length fields do not match');
  if (!p.checksumOk) throw new Error('Refused: checksum does not match');
  if (m.length > 64) throw new Error('Refused: message too long');
  if (QUESTION_CMDS.has(p.cmd)) {
    if (p.payload.some((b) => b !== 0) || p.payload.length > 2) throw new Error('Refused: a start-up question must not carry values');
    return;
  }
  if (p.cmd === 0x90) {
    if (!allowUnlock) throw new Error('Refused: the unlock message needs the step 2 permission');
    if (hex(m) !== hex(unlockMessage())) throw new Error('Refused: only the reference unlock message may be sent');
    return;
  }
  if (p.cmd === 0x02) {
    if (p.equip !== 0x04) throw new Error('Refused: read request for an unexpected equipment type');
    if (p.payload.length < 2 || p.payload[0] !== 0x00) throw new Error('Refused: this message has a write section (it would set a value on the treadmill)');
    if (p.payload.length !== 2 + p.payload[1]) throw new Error('Refused: read list length does not match');
    return;
  }
  throw new Error(`Refused: command 0x${p.cmd.toString(16)} is not on the allowed list`);
}

// ---- incoming frames --------------------------------------------------------

export interface Assembled {
  message: number[];
  /** False when the frames did not add up to the announced length. */
  complete: boolean;
}

/** Puts the 20-byte notifications from 1535 back together into whole messages. */
export class Reassembler {
  private buf: number[] = [];
  private expect = -1;
  private active = false;

  reset() { this.buf = []; this.expect = -1; this.active = false; }

  /** Returns a message when a frame completes one, otherwise null. `unknown` = not a frame of this scheme. */
  push(f: number[]): Assembled | 'unknown' | null {
    if (f.length < 2) return 'unknown';
    if (f[0] === 0xfe && f[1] === 0x02 && f.length >= 4) {
      this.buf = []; this.expect = f[2]; this.active = true;
      return null;
    }
    const n = f[1];
    if (n < 1 || n > FRAME_DATA || n > f.length - 2) return 'unknown';
    if (f[0] === 0xff) {
      const message = this.buf.concat(f.slice(2, 2 + n));
      const complete = this.expect < 0 || message.length === this.expect;
      this.reset();
      return { message, complete };
    }
    if (f[0] > 0x20) return 'unknown'; // a continuation index is a small number
    if (!this.active || f[0] === 0) { if (!this.active) this.expect = -1; if (f[0] === 0) this.buf = []; this.active = true; }
    this.buf = this.buf.concat(f.slice(2, 2 + n));
    return null;
  }
}

/**
 * Candidate values from a reply to a read (command 0x02). UNVERIFIED on the 105 CST: on the reference
 * console the first two values are speed and incline in hundredths. Shown in the Bluetooth Lab only.
 */
export function candidateFromReply(p: Parsed): { status: number; speedRaw: number; inclineRaw: number } | null {
  if (p.dir !== 'response' || p.cmd !== 0x02 || p.payload.length < 5) return null;
  return { status: p.payload[0], speedRaw: p.payload[1] | (p.payload[2] << 8), inclineRaw: p.payload[3] | (p.payload[4] << 8) };
}

// ---- speed check ------------------------------------------------------------
// Finds which bytes of a poll reply are the belt speed by comparing replies recorded at three
// different speeds with what the console showed. Nothing is assumed from the reference console.

export const KM_PER_MILE = 1.609344;
export type SpeedUnit = 'kmh' | 'mph';

export interface SpeedSample {
  /** What the console displayed, in `unit`. */
  shown: number;
  unit: SpeedUnit;
  /** The poll reply's value bytes (everything after the status byte). */
  values: number[];
  at: number;
}
export interface SpeedSlot { offset: number; scale: 100 | 10; rawUnit: SpeedUnit }

/** Value bytes of a reply to a read-only poll, or null if `p` is not such a reply. */
export function pollValues(p: Parsed): number[] | null {
  if (p.dir !== 'response' || p.cmd !== 0x02 || !p.checksumOk || !p.lengthOk || p.payload.length < 3) return null;
  return p.payload.slice(1);
}

const convert = (v: number, from: SpeedUnit, to: SpeedUnit) => (from === to ? v : from === 'mph' ? v * KM_PER_MILE : v / KM_PER_MILE);

/** Why a set of samples cannot be analysed yet, or null when it can. */
export function sampleProblem(samples: SpeedSample[]): string | null {
  if (samples.length < 3) return `Record ${3 - samples.length} more speed${samples.length === 2 ? '' : 's'}.`;
  if (samples.some((x) => x.values.length !== samples[0].values.length)) return 'The replies changed length between readings. Start again.';
  for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) {
    if (Math.abs(convert(samples[i].shown, samples[i].unit, 'kmh') - convert(samples[j].shown, samples[j].unit, 'kmh')) < 0.45) return 'Two readings are at nearly the same speed. Use three clearly different speeds.';
  }
  return null;
}

/**
 * Every position in the reply whose 16-bit value equals the console speed in ALL samples.
 * Tries hundredths and tenths, in km/h and mph. Three different speeds must all match at the
 * same position with the same rule, so a chance match is very unlikely.
 */
export function findSpeedSlots(samples: SpeedSample[]): SpeedSlot[] {
  if (sampleProblem(samples)) return [];
  const len = samples[0].values.length, out: SpeedSlot[] = [];
  for (const scale of [100, 10] as const) for (const rawUnit of ['kmh', 'mph'] as const) for (let offset = 0; offset + 1 < len; offset++) {
    const ok = samples.every((x) => {
      const raw = x.values[offset] | (x.values[offset + 1] << 8);
      if (raw === 0) return false;
      const tol = x.unit === rawUnit ? 0.051 : 0.1;
      return Math.abs(raw / scale - convert(x.shown, x.unit, rawUnit)) <= tol;
    });
    if (ok) out.push({ offset, scale, rawUnit });
  }
  return out;
}

/** Belt speed in km/h from a reply, using a verified slot. Null if the reply does not fit. */
export function decodeSpeed(values: number[], slot: SpeedSlot & { len: number }): number | null {
  if (values.length !== slot.len || slot.offset + 1 >= values.length) return null;
  const raw = values[slot.offset] | (values[slot.offset + 1] << 8);
  const kmh = convert(raw / slot.scale, slot.rawUnit, 'kmh');
  return kmh >= 0 && kmh <= 30 ? Math.round(kmh * 100) / 100 : null;
}
