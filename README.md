# ProForm Smart Control (version 0.10)

Unofficial phone app for the ProForm 105 CST treadmill. Not made by or connected with ProForm or iFIT.

## Put it on Netlify (no tools needed)

1. Unzip `proform-smart-control-netlify.zip`.
2. Go to app.netlify.com > Add new site > Deploy manually (or open your existing site > Deploys).
3. Drag the unzipped folder (the one with `index.html` inside) onto the page.
4. Open the `https://…netlify.app` link in **Chrome** on your Samsung phone.
5. Chrome menu (⋮) > Add to Home screen / Install app.

## Using Bluetooth

- Needs Chrome on Android (or Chrome/Edge on a laptop), the https link, and Bluetooth switched on.
- Android asks for the "Nearby devices" permission the first time.
- Tap **Connect treadmill**, pick **I_TL** in Chrome's list.
- Keep the app open and the screen on. A web page cannot hold a Bluetooth link in the background.
- More > Bluetooth Lab shows every packet and exports the log (TXT, CSV, JSON).
- A heart-rate strap or band connects from the Workout screen. It is a separate Bluetooth link.

## What this version does

| Status | Feature |
|---|---|
| Working | Workout dashboard: speedometer (animated needle, digital speed, target marker), AI coach card with male or female picture and the coach's last line, pace banner (below / on / above target, only with a live treadmill reading), time, distance, calories, heart rate, portrait and landscape; workout timer, distance and estimated calories from the speed you enter; six guided programs plus a custom builder with spoken cues; coach with weekly plan, goal and tips; history with day, week and month charts, streaks and CSV export; installable, opens offline; packet inspector and hex analyser |
| Built, not tested on real hardware | treadmill link (connect to I_TL, service 1533, read 1534/1535, notifications on 1535, disconnect detection, reconnect, saved sessions, log export); heart-rate strap; Kokoro voice; optional AI chat function |
| Confirmed on the 105 CST (22 Nov 2026) | Keeping the Bluetooth link open: six start-up questions answered, unlock accepted, 47 of 47 read-only polls answered with matching checksums, link held 72 s (it drops at about 17 s when the app stays silent) |
| Working | Pace match: while a guided plan runs, the screen shows the block's target speed and your real belt speed with a cue — "Speed up to X", "On pace", "Ease down to X" — so you match the plan on the console. The app only reads the speed |
| Confirmed on the 105 CST (23 Nov 2026) | Speed check and telemetry link: console 2, 3, 4 km/h = 200, 300, 400 at position 0 of the poll reply; link ran 169 s, 242 of 242 replies valid; the speedometer, distance and calories follow the reported speed |
| Not supported | Starting or stopping the belt from the phone (by design: console and safety key only); program or coach speed control (planned after the control test is proven); motorised incline; firmware update; iPhone/Firefox/Samsung Internet for Bluetooth |

**Read-only by default.** Ordinary use sends nothing to the treadmill. The only write path is `sendIfit()` in `src/ble/manager.ts`, used by the experimental test after the user allows it for one connection. Every message goes through `assertSafeRequest()` in `src/ble/ifit.ts`, which lets through start-up questions, the unlock message, pure reads, and one write: a plain set-speed message for the exact value the control test has just checked, inside hard limits of 1.0 to 16.0 km/h. Incline, start, stop and any other write are refused. `node tools/test-ifit.mjs` checks the codec and the guard against the published reference packets. The firmware update service is never requested. Protocol findings are in `docs/PROTOCOL.md`.

## Optional: AI chat for the coach

The coach works without any AI service. To add a free-text AI chat:

1. Deploy from GitHub instead of drag and drop (drag-and-drop deploys do not run functions). In Netlify: Add new site > Import an existing project > pick the repo. Build command `npm run build`, publish directory `dist` (already in `netlify.toml`).
2. In Netlify > Site configuration > Environment variables, add `ANTHROPIC_API_KEY`. Optional: `COACH_MODEL`.
3. Redeploy. The chat box then appears on the Coach page.

The key stays on Netlify's servers (`netlify/functions/coach.mjs`). It is never in the app's code. This function has not been run against the live service yet.

## Building from source (optional, on a computer)

```
npm install
npm run build      # output in dist/
```

The build uses esbuild for the React + TypeScript bundle and Tailwind CSS 4 for styles (`scripts/build.mjs`). `npm run icons` redraws the PNG icons from `public/icons/icon.svg`.

## Layout

- `src/ble/` treadmill Bluetooth manager (read-only), UUIDs, byte formatting, frame labels
- `src/db/` IndexedDB storage (workouts, Bluetooth sessions)
- `src/lib/` workout tracker, programs, coach rules, heart rate, calorie estimate, voice, settings, the coach caption (`coachline.ts`)
- `src/pages/` screens (`Workout.tsx` = the workout dashboard)
- `src/components/Dashboard.tsx` speedometer, coach card, pace banner and stats
- `public/coach/` the male and female coach pictures
- `netlify/functions/` optional AI chat
- `docs/PROTOCOL.md` protocol research notes
- `public/` manifest, icons, service worker
