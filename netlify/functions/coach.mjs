// Optional AI coach chat. The API key stays on Netlify's servers and is never
// sent to the browser. Set ANTHROPIC_API_KEY in Netlify > Site configuration >
// Environment variables. Without it, the app hides the chat box.
//
// Note: drag-and-drop deploys do not include functions. Deploy from GitHub
// (or the Netlify CLI) for this file to run.

const MODEL = process.env.COACH_MODEL || 'claude-haiku-5-5';

const SYSTEM = `You are a friendly treadmill fitness coach inside a phone app.
Give short, practical answers (under 120 words) about walking and running training, pacing, motivation and recovery.
You cannot control the treadmill and must never claim to. Tell the user to change speed on the console themselves.
You are not a doctor. Do not diagnose. For chest pain, dizziness, injury or medical conditions, tell the user to stop and see a doctor.
Do not give calorie targets, diets or weight-loss rates.`;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (req.method === 'GET') return json(200, { ok: Boolean(key) });
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  if (!key) return json(503, { error: 'AI chat is not set up on this site.' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Bad request' }); }
  const question = String(body?.question ?? '').slice(0, 600).trim();
  if (!question) return json(400, { error: 'Ask a question first.' });
  const context = JSON.stringify({ profile: body?.profile ?? null, week: body?.week ?? null }).slice(0, 800);

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM,
        messages: [{ role: 'user', content: `My training data: ${context}\n\nMy question: ${question}` }],
      }),
    });
    if (!r.ok) return json(502, { error: `The AI service answered ${r.status}.` });
    const data = await r.json();
    const answer = (data?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    return json(200, { answer: answer || 'No answer came back. Try again.' });
  } catch {
    return json(502, { error: 'Could not reach the AI service.' });
  }
};
