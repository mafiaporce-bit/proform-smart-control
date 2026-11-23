// Unit test for src/ble/ifit.ts against the reference packets. Run: node tools/test-ifit.mjs
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const out = '/tmp/ifit-test.mjs';
await build({ entryPoints: ['src/ble/ifit.ts'], bundle: true, format: 'esm', outfile: out, logLevel: 'silent' });
const I = await import(pathToFileURL(out) + '?' + Date.now());
const H = (s) => s.replace(/[^0-9a-f]/gi, '').match(/../g).map((x) => parseInt(x, 16));
const pad = (a) => { a = a.slice(); while (a.length < 20) a.push(0); return a; };
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '  ' + extra)); if (!cond) fails++; };
const same = (a, b) => I.hex(a) === I.hex(b);

// Reference start-up frames, exactly as published.
const REF = [
  ['FE020802', 'FF08 02 04 02 04 02 04 81 87'],
  ['FE020802', 'FF08 02 04 02 04 04 04 80 88'],
  ['FE020802', 'FF08 02 04 02 04 04 04 88 90'],
  ['FE020A02', 'FF0A 02 04 02 06 02 06 82 00 00 8a'],
  ['FE020A02', 'FF0A 02 04 02 06 02 06 84 00 00 8c'],
  ['FE020802', 'FF08 02 04 02 04 02 04 95 9b'],
];
I.QUESTIONS.forEach((q, i) => {
  const fr = I.toFrames(I.buildMessage(q.equip, q.cmd, q.payload));
  ok(`question ${i + 1} (0x${q.cmd.toString(16)}) reproduces the reference frames, checksum included`, fr.length === 2 && same(fr[0], H(REF[i][0])) && same(fr[1], pad(H(REF[i][1]))), I.hex(fr[1]));
  let threw = false; try { I.assertSafeRequest(I.buildMessage(q.equip, q.cmd, q.payload), false); } catch { threw = true; }
  ok(`question ${i + 1} passes the guard`, !threw);
});
// Unlock
const unlockRef = ['FE022C04', '0012 02 04 02 28 04 28 90 04 00 61 d8 5d d0 51 d0 55 e8 61', '0112 f8 8d 00 91 20 d5 48 e1 98 3d d0 71 10 b5 48 e1 b8 4d', 'FF08 e0 b1 40 80 02 00 00 75'];
const uf = I.toFrames(I.unlockMessage());
ok('unlock message reproduces the 4 reference frames, checksum 0x75 included', uf.length === 4 && uf.every((f, i) => same(f, i === 0 ? H(unlockRef[0]) : pad(H(unlockRef[i])))), uf.map(I.hex).join(' | '));
let t = false; try { I.assertSafeRequest(I.unlockMessage(), false); } catch { t = true; }
ok('unlock is refused without the step 2 permission', t);
t = false; try { I.assertSafeRequest(I.unlockMessage(), true); } catch { t = true; }
ok('unlock is allowed with the step 2 permission', !t);
{ const k = I.unlockMessage(); k[10] ^= 1; k[k.length - 1] = (k[k.length - 1] + ((k[10] & 1) ? 1 : -1)) & 255; t = false; try { I.assertSafeRequest(k, true); } catch { t = true; } ok('a changed unlock key is refused', t); }
// Poll B
const pf = I.toFrames(I.pollMessage(I.POLLS[0].read));
ok('poll B: header FE021403', same(pf[0], H('FE021403')));
ok('poll B: first chunk matches the published 16 bytes', same(pf[1].slice(0, 16), H('001202040210041002000A1394330010')), I.hex(pf[1]));
ok('poll B: last frame is FF 02 18 F2 (the captured checksum)', same(pf[2].slice(0, 4), H('FF0218F2')), I.hex(pf[2]));
for (const p of I.POLLS) { t = false; try { I.assertSafeRequest(I.pollMessage(p.read), false); } catch (e) { t = true; } ok(`poll ${p.id} passes the guard (pure read)`, !t); }
// Things that must be refused
const speedSet = (kmh) => { const v = Math.round(kmh * 100); return I.buildMessage(0x04, 0x02, [0x01, 0x01, v & 255, v >> 8, 0x00]); };
ok('set-speed layout matches the reference control frame', same(I.toFrames(speedSet(4.82))[1].slice(0, 13), H('FF0D020402090409020101E201').slice(0, 13)), I.hex(I.toFrames(speedSet(4.82))[1]));
const refuse = (name, m, allow = true) => { let th = ''; try { I.assertSafeRequest(m, allow); } catch (e) { th = e.message; } ok(`REFUSED: ${name}`, th !== '', 'was accepted'); if (th) console.log('        -> ' + th); };
refuse('set speed 3.0 km/h', speedSet(3));
refuse('set incline 2%', I.buildMessage(0x04, 0x02, [0x01, 0x02, 200, 0, 0x00]));
refuse('read with a hidden write bit', I.buildMessage(0x04, 0x02, [0x01, 0x00, 0x01, 0x03]));
refuse('unknown command 0x06', I.buildMessage(0x04, 0x06, []));
refuse('question carrying a value', I.buildMessage(0x02, 0x82, [0x01, 0x00]));
refuse('bad checksum', (() => { const m = I.pollMessage([0x03]); m[m.length - 1] ^= 0xff; return m; })());
refuse('wrong length field', (() => { const m = I.pollMessage([0x03]); m[3] += 1; return m; })());
refuse('raw bytes that are not a message', [0xfe, 0x02, 0x0d, 0x02]);
refuse('empty', []);
// Reassembly
const R = new I.Reassembler();
const msg = I.unlockMessage(); let got = null;
for (const f of I.toFrames(msg)) { const r = R.push(f); if (r && r !== 'unknown') got = r; }
ok('reassembler rebuilds a 4-frame message', got && got.complete && same(got.message, msg));
const reply = [0x01, 0x04, 0x02, 0x0b, 0x04, 0x0b, 0x02, 0x02, 0xe2, 0x01, 0x2c, 0x01, 0x05, 0x00]; reply.push(reply.slice(4).reduce((a, b) => (a + b) & 255, 0)); reply[3] = reply[5] = reply.length - 4; reply[reply.length - 1] = reply.slice(4, -1).reduce((a, b) => (a + b) & 255, 0);
got = null; for (const f of I.toFrames(reply)) { const r = R.push(f); if (r && r !== 'unknown') got = r; }
const pr = I.parseMessage(got.message), c = I.candidateFromReply(pr);
ok('a reply parses: response, lengths ok, checksum ok', pr.dir === 'response' && pr.lengthOk && pr.checksumOk);
ok('candidate values are read from the first two fields (482 and 300)', c && c.speedRaw === 482 && c.inclineRaw === 300, JSON.stringify(c));
ok('the 74-byte nRF read is not mistaken for a frame', (() => { const r = new I.Reassembler().push(H('68FE5720087F7F80249000F2EF0028FEFF40097EFB0008FFFF7FEF0600EDDF8200FFFF4800BFFF000004048FFF0404FFFF1000DBBF0040F7FFBDFE0000FFBF0002FFFF0050BAFE205400')); return r === 'unknown' || r === null; })());

// ---- the real ProForm 105 CST reply (22 Nov 2026, belt stopped) ----
const REAL = H('01 04 02 2B 04 2B 02 02 00 00 00 00 00 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 2C 01 2C 01 B4 00 B4 00 B4 00 AA');
const rp = I.parseMessage(REAL), rv = I.pollValues(rp);
ok('real 105 CST reply: response, lengths ok, checksum 0xAA ok', rp.dir === 'response' && rp.lengthOk && rp.checksumOk && rp.cmd === 2);
ok('real 105 CST reply: 38 value bytes after the status byte', rv && rv.length === 38, rv && rv.length);
got = null; { const R2 = new I.Reassembler(); for (const f of [H('FE 02 2F 04'), H('00 12 01 04 02 2B 04 2B 02 02 00 00 00 00 00 00 00 00 00 00'), H('01 12 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00'), H('FF 0B 2C 01 2C 01 B4 00 B4 00 B4 00 AA 00 00 00 00 00 00 00')]) { const r = R2.push(f); if (r && r !== 'unknown') got = r; } }
ok('real 105 CST frames reassemble to the same message', got && got.complete && same(got.message, REAL));
// a reply with given 16-bit values at given offsets, on top of the real one
const withSpeed = (pairs) => { const v = rv.slice(); for (const [o, raw] of pairs) { v[o] = raw & 255; v[o + 1] = raw >> 8; } return v; };
const smp = (shown, unit, pairs) => ({ shown, unit, values: withSpeed(pairs), at: 0 });
// km/h console, hundredths of km/h at offset 0 (target) and 15 (measured)
let S = [smp(2, 'kmh', [[0, 200], [15, 200]]), smp(3, 'kmh', [[0, 300], [15, 300]]), smp(4.5, 'kmh', [[0, 450], [15, 451]])];
let slots = I.findSpeedSlots(S);
ok('speed check: finds both matching positions (0 and 15), hundredths, km/h', slots.length === 2 && slots.every((x) => x.scale === 100 && x.rawUnit === 'kmh') && slots.map((x) => x.offset).join() === '0,15', JSON.stringify(slots));
ok('speed check: the constant 300 and 180 fields are NOT taken for speed', !slots.some((x) => x.offset >= 28));
ok('decode: 4.51 km/h from position 15', I.decodeSpeed(S[2].values, { ...slots[1], len: 38 }) === 4.51);
ok('decode: stopped belt reads 0', I.decodeSpeed(rv, { ...slots[1], len: 38 }) === 0);
ok('decode: a reply of another length is refused', I.decodeSpeed(rv.slice(0, 30), { ...slots[1], len: 38 }) === null);
// mph console, treadmill reports km/h x100
S = [smp(1.5, 'mph', [[15, 241]]), smp(2.5, 'mph', [[15, 402]]), smp(3.5, 'mph', [[15, 563]])];
slots = I.findSpeedSlots(S);
ok('speed check: console in mph, reply in km/h is matched', slots.length === 1 && slots[0].offset === 15 && slots[0].rawUnit === 'kmh' && slots[0].scale === 100, JSON.stringify(slots));
// tenths
S = [smp(2, 'kmh', [[4, 20]]), smp(3, 'kmh', [[4, 30]]), smp(4, 'kmh', [[4, 40]])];
slots = I.findSpeedSlots(S);
ok('speed check: tenths are matched too', slots.length === 1 && slots[0].scale === 10 && slots[0].offset === 4, JSON.stringify(slots));
// wrong typing: no match
S = [smp(2, 'kmh', [[15, 200]]), smp(3, 'kmh', [[15, 300]]), smp(5, 'kmh', [[15, 400]])];
ok('speed check: one wrong console number means NO match', I.findSpeedSlots(S).length === 0);
ok('speed check: belt-stopped replies never match (constant 300 is not accepted for "3.0")', I.findSpeedSlots([smp(3, 'kmh', []), smp(3.6, 'kmh', []), smp(1.8, 'kmh', [])]).length === 0);
ok('speed check: two samples are not enough', I.findSpeedSlots(S.slice(0, 2)).length === 0 && /more/.test(I.sampleProblem(S.slice(0, 2))));
ok('speed check: nearly equal speeds are rejected', /different/.test(I.sampleProblem([smp(3, 'kmh', []), smp(3.2, 'kmh', []), smp(5, 'kmh', [])]) || ''));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
