// Trainer coach voice (ElevenLabs "Charlie"). The API key stays on Netlify's servers and is never
// sent to the browser. Set ELEVENLABS_API_KEY in Netlify > Site configuration > Environment variables.
// Without it, the app falls back to its built-in voice (Kokoro / the phone voice).
//
// Only the fixed set of coach lines below can be spoken, so this cannot be used as a general
// text-to-speech proxy or to burn credits on arbitrary text. Each clip is cached hard by the browser,
// so a line is generated at most once per device.
//
// Note: drag-and-drop deploys do NOT include functions. Deploy from GitHub or the Netlify CLI for this
// to run. If it is missing, the app just uses its normal voice.

const VOICE_ID = 'IKne3meq5aSn9XLyUdCD'; // Charlie - Deep, Confident, Energetic
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';

// key -> exact words. Short, punchy, no numbers (the screen shows the numbers).
const LINES = {
  start: "Alright, let's move. Here we go!",
  push1: "Come on, you've got this!",
  push2: "Don't you quit on me now!",
  push3: "You're stronger than this. Keep going!",
  push4: "Push, push, push! Stay with it!",
  speedup: "Pick it up! A little faster, come on!",
  easedown: "Ease it back a touch. Settle in.",
  steady: "That's your pace. Hold it right there!",
  km: "Another kilometre down. Keep pushing!",
  half: "Halfway there. Don't stop now!",
  last: "Last stretch. Empty the tank!",
  finish: "Yes! That's how you finish. Great work!",
  safety: "Clip on your safety key first. Safety, then speed!",
  paused: "Timer paused. Catch your breath.",
  resumed: "And we're back. Let's go!",
  warn: "Change coming up in ten seconds. Get ready!",
  goal: "Goal time reached. You did it!",
  plandone: "Plan complete! Slow it down and stop the belt on the console.",
  saved: "Workout saved. Remember to stop the belt on the console.",
};

// The one line with a number in it: "Set it to 5.5 kilometres per hour!" The number must be a
// plain speed between 0.5 and 20 with at most one decimal, so nothing else can be spoken.
function speedLine(raw) {
  if (!/^\d{1,2}(\.\d)?$/.test(raw)) return null;
  const v = Number(raw);
  if (!(v >= 0.5 && v <= 20)) return null;
  return `Set it to ${v.toFixed(1)} kilometres per hour!`;
}

export default async (req) => {
  const key = process.env.ELEVENLABS_API_KEY;
  const url = new URL(req.url);
  const line = String(url.searchParams.get('line') || '').trim();

  // Availability probe for the app.
  if (url.searchParams.get('probe')) {
    return new Response(JSON.stringify({ ok: Boolean(key), lines: [...Object.keys(LINES), 'set'] }), {
      status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  if (!key) return new Response('Coach voice not set up', { status: 503 });
  const text = line === 'set' ? speedLine(String(url.searchParams.get('kmh') || '')) : LINES[line];
  if (!text) return new Response('Unknown line', { status: 404 });

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.5 } }),
    });
    if (!r.ok) return new Response(`Voice service error ${r.status}`, { status: 502 });
    const audio = await r.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable' },
    });
  } catch (e) {
    return new Response('Voice service unreachable', { status: 502 });
  }
};
