// api/index.js
// Vercel serverless function — Claude proxy with rate limiting
//
// ENV VARS needed in Vercel:
//   ANTHROPIC_API_KEY    → your Anthropic key
//   SUPABASE_URL         → https://ekogfglcsftpwmithxbi.supabase.co
//   SUPABASE_SERVICE_KEY → service_role key (Settings > API > service_role)

// ─── Daily search limits per plan ─────────────────
const LIMITS = {
  anonymous: 5,    // not logged in
  free:      20,   // free account
  pro:       300,  // pro account
};

// ─── In-memory store (per serverless instance) ────
// Good enough for low traffic. For scale: use Upstash Redis.
const store = new Map();

function getRateWindow(key) {
  const now   = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  let entry   = store.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + dayMs };
    store.set(key, entry);
  }
  return entry;
}

// ─── Check user plan in Supabase ──────────────────
async function getUserPlan(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !userId) return 'anonymous';
  try {
    const r = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const d = await r.json();
    return d?.[0]?.plan || 'free';
  } catch {
    return 'free'; // fail open — better UX
  }
}

// ─── Main ─────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured — missing API key' });

  // ── Identify user ──
  const userId = (req.headers['x-user-id'] || '').trim() || null;
  const rateKey = userId || `ip:${req.headers['x-forwarded-for'] || 'unknown'}`;

  // ── Get plan + limit ──
  const plan  = await getUserPlan(userId);
  const limit = LIMITS[plan] ?? LIMITS.free;
  const win   = getRateWindow(rateKey);

  if (win.count >= limit) {
    const resetInHours = Math.ceil((win.resetAt - Date.now()) / 3_600_000);
    return res.status(429).json({
      error:   'rate_limit',
      plan,
      limit,
      resetInHours,
      message: `سقف روزانه ${limit} جستجو تموم شد. ${resetInHours} ساعت دیگه ریست میشه.`,
    });
  }

  win.count++;

  // ── Validate body ──
  const { model, max_tokens, messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // ── Call Anthropic ──
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      model      || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 900,
        messages,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({ error: errText });
    }

    const data = await upstream.json();

    // Expose quota info to the client
    res.setHeader('X-RateLimit-Plan',      plan);
    res.setHeader('X-RateLimit-Limit',     limit);
    res.setHeader('X-RateLimit-Used',      win.count);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - win.count));

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
