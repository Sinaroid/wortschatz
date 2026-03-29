// api/index.js — Claude proxy with reliable search counting
//
// ENV VARS:
//   ANTHROPIC_API_KEY    → sk-ant-...
//   SUPABASE_URL         → https://ekogfglcsftpwmithxbi.supabase.co
//   SUPABASE_SERVICE_KEY → service_role key (NOT anon)

const LIMITS = { anonymous: 3, free: 50, pro: 9999 };

const SB_HEADERS = () => ({
  apikey: process.env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
});

// Get profile row — returns { plan, search_count } or null
async function getProfile(userId) {
  if (!userId || !process.env.SUPABASE_URL) return null;
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=plan,search_count`,
      { headers: SB_HEADERS() }
    );
    const d = await r.json();
    return d?.[0] || null;
  } catch { return null; }
}

// Increment search_count with direct PATCH (no RPC needed)
async function incrementCount(userId, currentCount) {
  if (!userId || !process.env.SUPABASE_URL) return;
  try {
    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: SB_HEADERS(),
        body: JSON.stringify({ search_count: currentCount + 1 }),
      }
    );
  } catch (e) { console.error('increment error:', e.message); }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY missing' });

  const userId = (req.headers['x-user-id'] || '').trim() || null;

  // ── Get profile ──
  const profile = await getProfile(userId);
  const plan = profile?.plan || (userId ? 'free' : 'anonymous');
  const searchCount = profile?.search_count || 0;
  const limit = LIMITS[plan] ?? LIMITS.free;

  // ── Check limit ──
  if (searchCount >= limit) {
    return res.status(429).json({
      error: 'rate_limit',
      plan, limit,
      used: searchCount,
      remaining: 0,
      message: `${limit} جستجوی رایگان تموم شد. برای ادامه به Pro ارتقا بده.`,
    });
  }

  // ── Validate body ──
  const { model, max_tokens, messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: 'messages required' });

  // ── Call Anthropic ──
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 900,
        messages,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({ error: errText });
    }

    const data = await upstream.json();

    // ── Increment AFTER successful response ──
    if (userId) {
      await incrementCount(userId, searchCount); // await = reliable
    }

    const newCount = searchCount + 1;
    const remaining = Math.max(0, limit - newCount);

    res.setHeader('X-RateLimit-Plan', plan);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Used', String(newCount));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
