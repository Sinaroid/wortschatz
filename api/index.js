// api/index.js — Claude proxy with daily search limiting
// ENV: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

import { createClient } from '@supabase/supabase-js';

const LIMITS = {
  anonymous: 2,
  free:      10,   // روزانه — reset هر شب
  beta:      500,
  pro:       9999,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY missing' });

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );

  const userId = (req.headers['x-user-id'] || '').trim() || null;

  let plan = userId ? 'free' : 'anonymous';
  let searchCount = 0;

  if (userId) {
    const { data: profile } = await sb
      .from('profiles')
      .select('plan, search_count, is_beta, search_reset_at')
      .eq('id', userId)
      .single();

    if (profile) {
      plan = profile.is_beta ? 'beta' : (profile.plan || 'free');

      // بررسی daily reset
      const now = new Date();
      const resetAt = profile.search_reset_at ? new Date(profile.search_reset_at) : null;

      if (!resetAt || now >= resetAt) {
        // روز جدید — reset
        searchCount = 0;
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        await sb.from('profiles').update({
          search_count: 0,
          search_reset_at: tomorrow.toISOString()
        }).eq('id', userId);
      } else {
        searchCount = profile.search_count || 0;
      }
    } else {
      // profile نداره
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      await sb.from('profiles').upsert({
        id: userId, plan: 'free', word_count: 0,
        search_count: 0, is_beta: false,
        search_reset_at: tomorrow.toISOString()
      });
    }
  }

  const limit = LIMITS[plan] ?? LIMITS.free;

  if (searchCount >= limit) {
    // محاسبه ساعت تا reset
    const { data: p } = userId ? await sb.from('profiles')
      .select('search_reset_at').eq('id', userId).single() : { data: null };
    const resetAt = p?.search_reset_at ? new Date(p.search_reset_at) : new Date();
    const hoursLeft = Math.ceil((resetAt - new Date()) / 3_600_000);

    return res.status(429).json({
      error: 'rate_limit', plan, limit, used: searchCount, remaining: 0,
      reset_hours: hoursLeft,
      message: `${limit} جستجوی امروز تموم شد. ${hoursLeft} ساعت دیگه reset میشه — یا Pro بگیر 🚀`,
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
      return res.status(upstream.status).json({ error: await upstream.text() });
    }

    const data = await upstream.json();

    // Increment
    if (userId) {
      await sb.from('profiles')
        .update({ search_count: searchCount + 1 })
        .eq('id', userId);
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
