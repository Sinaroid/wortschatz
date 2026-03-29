// api/index.js — Claude proxy + reliable search counting
// ENV VARS: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

const LIMITS = { anonymous: 3, free: 50, pro: 9999 };

async function sbFetch(path, opts={}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if(!url || !key) return null;
  try {
    const r = await fetch(url + path, {
      ...opts,
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
        ...(opts.headers||{}),
      }
    });
    if(opts.method === 'PATCH') return r.status < 300 ? true : null;
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  } catch(e) {
    console.error('sbFetch error:', e.message);
    return null;
  }
}

async function getProfile(userId) {
  if(!userId) return null;
  const data = await sbFetch(`/rest/v1/profiles?id=eq.${userId}&select=plan,search_count`);
  return data?.[0] || null;
}

async function incrementCount(userId, currentCount) {
  if(!userId) return;
  const newCount = (currentCount || 0) + 1;
  console.log(`increment user=${userId} from ${currentCount} to ${newCount}`);
  const result = await sbFetch(`/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({ search_count: newCount }),
  });
  console.log('PATCH result:', result);
  return result;
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
  console.log('Request userId:', userId);

  const profile = await getProfile(userId);
  console.log('Profile:', profile);

  const plan = profile?.plan || (userId ? 'free' : 'anonymous');
  const searchCount = typeof profile?.search_count === 'number' ? profile.search_count : 0;
  const limit = LIMITS[plan] ?? LIMITS.free;

  console.log(`plan=${plan} count=${searchCount} limit=${limit}`);

  if (searchCount >= limit) {
    return res.status(429).json({
      error: 'rate_limit', plan, limit, used: searchCount, remaining: 0,
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
      const errText = await upstream.text();
      return res.status(upstream.status).json({ error: errText });
    }

    const data = await upstream.json();

    // increment — await برای مطمئن بودن
    if (userId) {
      await incrementCount(userId, searchCount);
    }

    const newCount = searchCount + 1;
    const remaining = Math.max(0, limit - newCount);

    res.setHeader('X-RateLimit-Plan', plan);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Used', String(newCount));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    return res.status(200).json(data);
  } catch (err) {
    console.error('Anthropic error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
