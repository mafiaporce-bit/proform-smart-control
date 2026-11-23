// What published research on related iFit "I_TL" consoles says about framing,
// applied here as LABELS ONLY. Sources: hms-homelab/nordictrack_t5 (MIT,
// validated on a NordicTrack T-series console) and QZ (qdomyos-zwift).
// None of this is confirmed on the ProForm 105 CST, and nothing in this file
// builds or sends a packet.

export interface FrameLabel {
  role: 'first' | 'continuation' | 'last' | 'unknown';
  text: string;
}

/** Labels a frame by the marker scheme used on related models. */
export function labelFrame(b: number[]): FrameLabel {
  if (b.length !== 20) {
    return { role: 'unknown', text: `${b.length} bytes. Related models use 20-byte frames, so this does not fit that scheme.` };
  }
  if (b[0] === 0xfe) return { role: 'first', text: `Looks like a message header (FE). Byte 1 = ${b[1]}: total payload size on related models.` };
  if (b[0] === 0xff) return { role: 'last', text: `Looks like a final frame (FF). Byte 1 = ${b[1]}: bytes used in this frame on related models.` };
  if (b[0] < 0x10) return { role: 'continuation', text: `Looks like frame number ${b[0]} of a message. Byte 1 = ${b[1]}: bytes used in this frame on related models.` };
  return { role: 'unknown', text: 'First byte is not a known frame marker (FE, FF or a small sequence number).' };
}

export interface CandidateTelemetry {
  page: number;
  speedRaw: number;
  inclineRaw: number;
  byte14: number;
}

/**
 * On a NordicTrack T-series console, a 20-byte frame starting 00 12 01 04 02
 * carries live state: speed at bytes 10-11 and incline at bytes 12-13 (little
 * endian, hundredths). Returns the raw candidates, or null if the frame does
 * not match. UNVERIFIED on the 105 CST: shown only in the Bluetooth Lab so it
 * can be compared with the console.
 */
export function candidateTelemetry(b: number[]): CandidateTelemetry | null {
  if (b.length !== 20) return null;
  if (!(b[0] === 0x00 && b[1] === 0x12 && b[2] === 0x01 && b[3] === 0x04 && b[4] === 0x02)) return null;
  if (b.slice(12).every((x) => x === 0xff)) return null; // filler frame on the reference console
  return { page: b[5], speedRaw: b[10] | (b[11] << 8), inclineRaw: b[12] | (b[13] << 8), byte14: b[14] };
}

export const SOURCES = [
  { name: 'nordictrack_t5: I_TL protocol notes', url: 'https://github.com/hms-homelab/nordictrack_t5/blob/main/docs/TREADMILL_PROTOCOL.md' },
  { name: 'QZ (qdomyos-zwift): proformtreadmill.cpp', url: 'https://github.com/cagnulein/qdomyos-zwift/blob/master/src/devices/proformtreadmill/proformtreadmill.cpp' },
];
