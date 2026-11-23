// Byte formatting for the packet inspector. Nothing here interprets bytes as
// speed, distance or any other workout value: that needs a validated protocol.

export const toHex = (bytes: ArrayLike<number>, sep = '-') =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(sep);

/** Accepts "68-FE-57", "68 FE 57", "68fe57", "0x68, 0xFE". Returns null if not valid hex. */
export function parseHex(text: string): number[] | null {
  const clean = text.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  if (!clean.length || clean.length % 2 !== 0) return null;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

export const toAscii = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('');

export const u16le = (bytes: ArrayLike<number>) => {
  const out: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) out.push(bytes[i] | (bytes[i + 1] << 8));
  return out;
};

export const u16be = (bytes: ArrayLike<number>) => {
  const out: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) out.push((bytes[i] << 8) | bytes[i + 1]);
  return out;
};

export const toBinary = (b: number) => b.toString(2).padStart(8, '0');

export const sumMod256 = (bytes: ArrayLike<number>) => Array.from(bytes).reduce((a, b) => (a + b) & 0xff, 0);

export function clockTime(ms: number) {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
