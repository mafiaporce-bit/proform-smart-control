import { Icon } from '../components/icons';
import { Card, Footer, PageHeader, go } from '../components/ui';

const links = [
  { route: 'diagnostics', icon: 'flask', title: 'Bluetooth Lab', sub: 'Connection tester, packet inspector, log export' },
  { route: 'programs', icon: 'list', title: 'Training Programs', sub: 'Six guided plans and a custom builder' },
  { route: 'coach', icon: 'spark', title: 'AI Coach', sub: 'Weekly plan, goals and spoken tips' },
  { route: 'settings', icon: 'gear', title: 'Settings', sub: 'Voice, weight, install, your data' },
];

export const STATUS_GROUPS: Array<{ title: string; tone: string; items: string[] }> = [
  {
    title: 'Working',
    tone: 'text-good',
    items: [
      'Workout timer with distance and estimated calories from the speed you enter',
      'Six training programs and a custom builder, with spoken speed cues',
      'Coach: weekly plan, achievable goal, progress and tips (no AI service needed)',
      'Workout dashboard in three styles (Classic Speedometer, Digital Odometer, Smart Coaching): live speed and target, AI coach card (male or female picture), time, distance, calories and heart rate',
      'History with daily, weekly and monthly charts, streaks and CSV export',
      'Installable app that opens offline (everything except Bluetooth)',
      'Packet inspector and hex analyser',
    ],
  },
  {
    title: 'Built, not yet tested on your treadmill',
    tone: 'text-cyan',
    items: [
      'Bluetooth connect to I_TL, service 1533 discovery, reading 1534 and 1535, notifications on 1535',
      'Disconnect detection, reconnect, saved diagnostic sessions and log export',
      'Heart-rate strap over standard Bluetooth (listen-only)',
      'Kokoro voice (needs internet the first time to download the voice)',
      'Optional AI chat through a Netlify Function (needs a GitHub deploy and an API key)',
      'Charlie trainer voice (a real human-sounding coach via ElevenLabs): plays push, pace and milestone lines during a run. Needs the ELEVENLABS_API_KEY on Netlify and a GitHub or CLI deploy; falls back to the standard voice if it is not set up. Each line is saved after the first play so it works offline',
    ],
  },
  {
    title: 'Still experimental',
    tone: 'text-warn',
    items: [
      'Keeping the link open: confirmed on this 105 CST on 22 Nov 2026 (start-up questions answered, unlock accepted, 47 of 47 read polls answered, link held 72 s). Runs only when you start it in the Bluetooth Lab, or as the telemetry link after the speed check',
      'Reading speed and matching a plan: confirmed on this 105 CST on 23 Nov 2026. The speedometer, distance and calories follow the real belt speed, and a guided plan shows a Speed up / On pace / Ease down cue so you match it on the console. The app only reads the speed',
    ],
  },
  {
    title: 'Not supported',
    tone: 'text-bad',
    items: [
      'Changing speed, stopping or starting the belt from the phone',
      'Motorised incline (this treadmill has a manual incline)',
      'Firmware updates (never touched by this app)',
      'iPhone, Firefox and Samsung Internet for Bluetooth',
    ],
  },
];

export function More() {
  return (
    <>
      <PageHeader title="More" sub="Tools and settings" />
      <div className="space-y-2.5">
        {links.map((l) => (
          <button key={l.route} className="glass flex w-full items-center gap-3 p-4 text-left active:scale-[0.98]" onClick={() => go(l.route)}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-cyan"><Icon name={l.icon} /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{l.title}</span>
              <span className="block text-[13px] text-mute">{l.sub}</span>
            </span>
            <Icon name="chevron" size={18} className="text-dim" />
          </button>
        ))}
      </div>

      <h2 className="label mt-6 px-1">What this version does</h2>
      <div className="mt-2 space-y-2.5">
        {STATUS_GROUPS.map((g) => (
          <Card key={g.title}>
            <div className={`text-[13px] font-bold ${g.tone}`}>{g.title}</div>
            <ul className="mt-1.5 space-y-1.5 text-[13.5px] text-mute">
              {g.items.map((i) => (
                <li key={i} className="flex gap-2"><span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current ${g.tone}`} /><span>{i}</span></li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <p className="mt-4 px-1 text-[12px] text-dim">
        Unofficial app. Not made by, or connected with, ProForm or iFIT.
      </p>
      <Footer />
    </>
  );
}
