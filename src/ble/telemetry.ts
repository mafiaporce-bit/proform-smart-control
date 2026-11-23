// Treadmill speed for the rest of the app (Virtual Running, the workout engine).
//
// The speed is null unless ALL of this is true:
//   1. the speed check in the Bluetooth Lab matched the console at three different speeds and the
//      user saved it (src/ble/speedcal.ts),
//   2. the telemetry session is running and a poll reply arrived in the last 3 seconds,
//   3. that reply has a matching checksum and the same length as when it was verified.
// The unverified "candidate" numbers shown in the Lab are never used here.

import { ifitTest, useIfitTest } from './experiment';
import { setMeasuredSpeed } from '../lib/workout';

/** Live treadmill speed in km/h, or null when there is no verified, fresh reading. */
export function useTreadmillSpeed(): number | null {
  return useIfitTest().speedKmh;
}

// The workout engine counts distance and calories from the real belt speed whenever there is one.
ifitTest.subscribe(() => setMeasuredSpeed(ifitTest.getState().speedKmh));
