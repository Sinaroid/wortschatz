import { createClient } from '@supabase/supabase-js';

const FREE_LIMIT = 10;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const userId = (req.headers['x-user-id'] || '').trim();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Rate limit check for free users
  if (userId) {
    const { data: profile } = await sb.from('profiles')
      .select('plan, search_count, search_reset_at')
      .eq('id', userId).single();

    if (profile && profile.plan === 'free') {
      const now = new Date();
      const resetAt = profile.search_reset_at ? new Date(profile.search_reset_at) : null;
      let count = profile.search_count || 0;

      if (!resetAt || now >= resetAt) {
        count = 0;
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        await sb.from('profiles').update({ search_count: 0, search_reset_at: tomorrow.toISOString() }).eq('id', userId);
      }

      if (count >= FREE_LIMIT) {
        return res.status(429).json({
          error: 'rate_limit',
          message: `جستجوی امروز تموم شد`,
          reset_hours: Math.ceil((new Date(profile.search_reset_at) - now) / 3600000)
        });
      }

      // increment
      await sb.from('profiles').update({ search_count: count + 1 }).eq('id', userId);
      res.setHeader('X-RateLimit-Used', String(count + 1));
      res.setHeader('X-RateLimit-Remaining', String(FREE_LIMIT - count - 1));
    }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
