# Protocol research notes

Status: **nothing below has been confirmed on the ProForm 105 CST yet.** Ordinary use sends nothing to the treadmill. Version 0.7 adds an opt-in test (see "Experimental iFit Telemetry Mode" at the end).

## Sources

- hms-homelab/nordictrack_t5 (MIT): `docs/TREADMILL_PROTOCOL.md`. An ESP32 bridge validated on a NordicTrack T-series console, firmware string `2017.0908`, which also advertises as `I_TL` with service `00001533-1412-efde-1523-785feabcd123`.
- cagnulein/qdomyos-zwift (QZ): `src/devices/proformtreadmill/proformtreadmill.cpp`. The file is about 10,000 lines with a separate branch per model. It could not be read line by line for these notes (GitHub blocks automated reading of the raw file), so QZ details here come through the nordictrack_t5 write-up, which builds on QZ's `nordictrack10` branch. Whether QZ has a branch for the 105 CST is **not established**.

## What the sources agree on

| Topic | Finding on the reference console | Confirmed on 105 CST? |
|---|---|---|
| Channels | 1535 = treadmill to phone (notify). 1534 = phone to treadmill (write) | UUIDs and properties match your nRF scan |
| Push or poll | Host-polled. The console sends nothing unless asked | No |
| Disconnects | Subscribe-only links dropped after roughly 10 to 20 s. Links polled every 200 ms stayed up for the 75 s captures | Your nRF log shows drops within about 20 s of connecting, which fits but does not prove it |
| Handshake | A fixed sequence of frames is written to 1534 about 400 to 600 ms apart before polling. The bytes are replayed as captured; their meaning was not decoded | No |
| Framing | 20-byte frames. `FE` = first frame, byte 1 = total payload size. `00`, `01`, … = continuation index. `FF` = last frame | No |
| Live state | One 20-byte frame starting `00 12 01 04 02`. Byte 5 is a page id that differs between consoles (`0x29`, `0x2F`, `0x31`, `0x34` seen). Speed = bytes 10-11 LE ÷ 100. Incline = bytes 12-13 LE ÷ 100. Frames with bytes 12-19 all `FF` are filler | No |
| Units | Speed unit is ambiguous in the source (km/h in one place, machine units in another) | No |
| Distance, time, calories | Not sent. Host apps integrate speed over time | n/a |
| Set speed | Known frame layout with the value as hundredths and a checksum whose formula differs between model branches | No |
| Start / stop | Not documented | No |
| Acknowledgement | Not documented | No |

## What this means for the 105 CST

1. A listen-only connection (this app, nRF Connect) will probably receive nothing useful and be dropped after 10 to 20 seconds.
2. Keeping the link open and reading speed needs two kinds of write to 1534: the start-up handshake, then a poll roughly every 200 ms.
3. The only handshake available is the one captured from a different console. The source itself says start-up bytes may vary by model and recommends capturing from your own unit.
4. The 74-byte value read from 1535 in nRF Connect does not fit the 20-byte frame scheme, so it is not a live-state frame.

## Safe next steps, in order

1. **Capture, do not guess.** Record the official iFit app talking to the 105 CST (Android "Bluetooth HCI snoop log" in Developer options), then compare its start-up frames with the reference sequence. This is the only route that needs no unverified write.
2. **Handshake test (needs the owner's explicit go-ahead).** With the belt stopped, the safety key removed and nobody on the deck, send the reference handshake and query-only polls, and log every reply. No speed, start or stop frame.
3. **Validate decode.** With replies arriving, compare the candidate speed bytes against the console at three or more speeds, and settle the unit.
4. **Only then** consider speed control, starting with a single small change, confirmed by the console and by the next state frame.

## Message layout (worked out in version 0.7)

Reassembling the reference frames gives whole messages with this layout:

`02 04 02 | L | equipment | L | command | payload… | checksum`

- `L` counts the bytes from `equipment` to `checksum`. `checksum` = sum of `equipment` … last payload byte, modulo 256.
- This rule reproduces the checksum of all six short start-up messages (0x87, 0x88, 0x90, 0x8A, 0x8C, 0x9B), of the long one (0x75) and of the poll (0xF2). `node tools/test-ifit.mjs` proves it byte for byte.
- The six short start-up messages (commands 0x81, 0x80, 0x88, 0x82, 0x84, 0x95) carry no values: empty payload or two zero bytes. They are questions.
- Command 0x90 carries a 36-byte key. On the reference console it unlocks the session. The key may differ on the 105 CST.
- Command 0x02 payload = `[n write-list bytes][write list][values][n read-list bytes][read list]`. The reference set-speed frame has a 1-byte write list (bit 0 = speed, bit 1 = incline) and a 2-byte value. The reference poll has an **empty** write list and a 10-byte read list: a pure read.
- The public write-up lost the last 4 bytes of the poll's first chunk. The completion `40 10 00 80` makes the captured checksum 0xF2 come out right, so the test tries that first, then the write-up's zero-padded list (with a correct checksum), then a minimal list (first two values only).
- Replies start `01 04 02` with the same layout. The reference live frame `00 12 01 04 02 29 04 29 02 02 …` is the first chunk of such a reply: the "page id" is really the length, and speed and incline are the first two values after a status byte.

## Experimental iFit Telemetry Mode (version 0.7)

- Lives in the Bluetooth Lab. Off by default, switched on for one connection at a time after three tick boxes. Reuses the one connection manager.
- Step 1: the six questions, one by one, each reply recorded. Step 2 (separate permission): the unlock message, then read-only polling, one frame every 200 ms. If the console answers no question at all, the unlock is not sent automatically.
- Guard: `assertSafeRequest()` in `src/ble/ifit.ts` runs inside the only write function. It refuses anything that is not a question, the reference unlock or a read with an empty write list. No code builds a message with a write list.
- Result: PASS needs 60 s connected **and** fresh replies to polls. "Connected" alone is never reported as success. Speed stays "not verified"; the candidate value is shown in the Lab only.
- Tested against a simulated console only (accepts all, waits for permission, silent, answers only the minimal poll, rejects the unlock). **Not yet run on the real treadmill.**
- If the 105 CST rejects the unlock key, the next step is still the capture: record the official iFit app (Android Bluetooth HCI snoop log) and read the real key from it. A native Android bridge is only needed if Chrome itself turns out to be the obstacle (for example pairing or connection settings a web page cannot control).

## What the app does with this today

- `src/ble/protocol.ts` labels incoming frames by the scheme above and shows a **candidate** decode in the Bluetooth Lab, marked unverified. No other screen uses it.
- One write call exists: `sendIfit()` in `ble/manager.ts`, behind the guard described above. Read-only mode never reaches it.

## Results on the ProForm 105 CST (22 Nov 2026, belt stopped)

- Read-only connections: 13 in a row dropped after 16.8 to 17.8 s with one packet (the read of 1535).
- Stability test: all six questions answered, unlock answered, poll B answered 47 of 47 times, every checksum matched, still connected at 72 s when stopped by hand.
- Poll B reply (47 bytes): `01 04 02 2B 04 2B 02 | 02 | 38 value bytes | AA`. With the belt stopped the value bytes are zero except position 12 = `01`, positions 28 and 30 = 300, positions 32, 34, 36 = 180. What these are is not known yet. Position 0 was 0, which fits "speed" but proves nothing.

## Speed check and telemetry link (version 0.8)

- `findSpeedSlots()` in `src/ble/ifit.ts` takes three replies recorded at three console speeds and returns every position whose 16-bit value equals the console in all three (hundredths or tenths, km/h or mph). No position is assumed. If several match, the one that ramped through the most values is used (measured speed rather than target).
- The user saves the match (`src/ble/speedcal.ts`, key `psc.speedCal`). Only then does `useTreadmillSpeed()` return a number, and only for a reply with a matching checksum, the verified length, and no older than 3 s.
- Telemetry link (`settings.telemetryLink`, switched on when the check is saved): on every connection the app runs questions, unlock and read-only polls by itself, through the same guard. Frames are counted, not logged one by one. Switching it off returns to plain read-only.
- The workout engine uses the real speed for distance and calories while it is available (`setMeasuredSpeed`); a stopped belt adds no distance. If the link drops, the workout carries on at the last real speed in Simulation Mode. Saved workouts are marked `source: 'treadmill'` when most of the time was measured.
- Still not possible and not attempted: setting speed, incline, start or stop.

## Results with the belt moving (23 Nov 2026) and what the reply fields are

- Speed check on the 105 CST: console 2, 3, 4 km/h gave 200, 300, 400 at position 0 (and its copy at position 2). Saved as verified: position 0, ÷100, km/h.
- Position 0 changes the moment the console button is pressed, so it is the **set** speed. Positions 15 and 17 are a belt reading that ramps and then settles a little high (about 2.3 to 2.5 at 2.0, 3.15 to 3.25 at 3.0, 4.1 to 4.2 at 4.0, nobody on the belt).
- Position 4 counts seconds while the belt runs. Position 12 is 1 with the belt stopped and 2 with it running. Positions 13 and 19 count up about every 0.7 s. Positions 23 to 25 grow with distance. Positions 28 to 37 stayed 300, 300, 180, 180, 180.
- Telemetry link: 169 s, 242 of 242 replies valid. One earlier connection failed after 127 s with a GATT error, shortly after the polls had slowed to one a second, which is what a hidden or dimmed page does to timers. Version 0.9 keeps the screen on during a session and drops the gaps between frames while the page is hidden.

## Speed control test (version 0.9, Part 1)

- Message: the reference set-speed layout, `02 04 02 09 04 09 02 | 01 01 LO HI 00 | checksum`: write list of one byte with only the speed bit, a 16-bit value in hundredths of km/h, empty read list. `speedMessage()` reproduces the reference frame byte for byte.
- Guard (`assertSafeRequest`): this is the only write shape accepted, only with a permit, only inside the permit and inside 1.0 to 16.0 km/h. The control code passes a permit for the single value it is about to send. Value 0, incline, combined writes and other equipment types are refused; the unit test covers each.
- Rules before a step (`src/ble/control.ts`): speed verified with position 0 among the matches; link polling with a reply under 1.5 s old; page visible; belt already running (position 12 = 2 and set speed at least 1.0), so the app never starts the belt; one 0.5 km/h step from the set speed the treadmill reports; result within 1.0 to 6.0 km/h; previous step judged first.
- Judging a step: the treadmill must report the new set speed within 6 s, the belt reading must move at least 60% of the step the right way within 10 s, and the user must confirm the console. A different reported speed, or a "No" from the user, locks control for that connection. One good step up and one down mark control as proven (`psc.speedControl`).
- Not part of this version: programs or the coach changing speed, any start or stop, incline.

## Speed control removed (23 Nov 2026)

The version 0.9 speed control test was removed at the owner's decision. Reading speed needs no control of the treadmill, and the reverse-engineered control path (a computed security unlock plus an "arming" write that takes the console's START button out of local control) was judged not worth the safety trade. The app is read-only again: the one write path and its guard were taken out, and `node tools/test-ifit.mjs` confirms any write-section message is refused. Instead, a guided plan shows the target speed and a Speed up / On pace / Ease down cue (`src/components/PaceMatch.tsx`) so the user matches it on the console.
