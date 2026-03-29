// api/index.js
// Claude proxy with Supabase-backed rate limiting
//
// ENV VARS (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY    → sk-ant-...
//   SUPABASE_URL         → https://ekogfglcsftpwmithxbi.supabase.co
//   SUPABASE_SERVICE_KEY → service_role key

// ─── Limits: جستجو در روز ────────────────────────
const LIMITS = {
  anonymous: 5,
  free:      50,   // ← اینجا limit جستجوست نه لغت
  pro:       500,
};

// ─── Get user plan + search_count from Supabase ──
async function getUserData(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key || !userId) return { plan: 'anonymous', searchCount: 0 };

  try {
    const r = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan,search_count,search_reset_at`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const d = await r.json();
    if (!d?.[0]) return { plan: 'free', searchCount: 0 };

    const row = d[0];
    const now = new Date();
    const resetAt = row.search_reset_at ? new Date(row.search_reset_at) : null;

    // اگه reset_at گذشته، count رو صفر کن
    if (!resetAt || now > resetAt) {
      return { plan: row.plan || 'free', searchCount: 0, needsReset: true };
    }

    return { plan: row.plan || 'free', searchCount: row.search_count || 0 };
  } catch {
    return { plan: 'free', searchCount: 0 };
  }
}

// ─── Increment search count in Supabase ──────────
async function incrementSearchCount(userId, needsReset) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !userId) return;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const body = needsReset
    ? { search_count: 1, search_reset_at: tomorrow.toISOString() }
    : { search_count_increment: 1 }; // fallback to RPC below

  try {
    if (needsReset) {
      await fetch(
        `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ search_count: 1, search_reset_at: tomorrow.toISOString() }),
        }
      );
    } else {
      // atomic increment via RPC
      await fetch(`${url}/rest/v1/rpc/increment_search_count`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: userId }),
      });
    }
  } catch (e) {
    console.error('increment failed:', e);
  }
}

// ─── Main ─────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured' });

  const userId = (req.headers['x-user-id'] || '').trim() || null;

  // ── Rate limit check ──
  const { plan, searchCount, needsReset } = await getUserData(userId);
  const limit = LIMITS[plan] ?? LIMITS.free;

  if (searchCount >= limit) {
    return res.status(429).json({
      error: 'rate_limit',
      plan,
      limit,
      used: searchCount,
      message: `سقف روزانه ${limit} جستجو تموم شد. فردا ریست میشه.`,
    });
  }

  // ── Validate ──
  const { model, max_tokens, messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages required' });
  }

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
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: err });
    }

    const data = await upstream.json();

    // ── Increment counter (fire and forget) ──
    if (userId) incrementSearchCount(userId, needsReset).catch(() => {});

    const remaining = Math.max(0, limit - searchCount - 1);
    res.setHeader('X-RateLimit-Plan', plan);
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Used', searchCount + 1);
    res.setHeader('X-RateLimit-Remaining', remaining);

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
