// api/index.js — Claude proxy with total search limiting
//
// ENV VARS (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY    → sk-ant-...
//   SUPABASE_URL         → https://ekogfglcsftpwmithxbi.supabase.co
//   SUPABASE_SERVICE_KEY → service_role key

const LIMITS = {
  anonymous: 3,    // بدون اکانت
  free:      50,   // کل جستجو در نسخه رایگان
  pro:       9999, // نامحدود
};

async function getUserData(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !userId) return { plan: 'anonymous', searchCount: 0 };
  try {
    const r = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan,search_count`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const d = await r.json();
    if (!d?.[0]) return { plan: 'free', searchCount: 0 };
    return { plan: d[0].plan || 'free', searchCount: d[0].search_count || 0 };
  } catch {
    return { plan: 'free', searchCount: 0 };
  }
}

async function incrementSearchCount(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !userId) return;
  try {
    await fetch(`${url}/rest/v1/rpc/increment_search_count`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId }),
    });
  } catch (e) {
    console.error('increment failed:', e);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured' });

  const userId = (req.headers['x-user-id'] || '').trim() || null;
  const { plan, searchCount } = await getUserData(userId);
  const limit = LIMITS[plan] ?? LIMITS.free;

  if (searchCount >= limit) {
    return res.status(429).json({
      error: 'rate_limit',
      plan, limit, used: searchCount,
      message: `${limit} جستجوی رایگان تموم شد. برای ادامه به Pro ارتقا بده.`,
    });
  }

  const { model, max_tokens, messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: 'messages required' });

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
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: err });
    }

    const data = await upstream.json();

    // increment در Supabase
    if (userId) incrementSearchCount(userId).catch(() => {});

    const newCount = searchCount + 1;
    const remaining = Math.max(0, limit - newCount);
    res.setHeader('X-RateLimit-Plan', plan);
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Used', newCount);
    res.setHeader('X-RateLimit-Remaining', remaining);

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
