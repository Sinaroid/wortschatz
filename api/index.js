// api/index.js — Claude proxy
// ENV: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

import { createClient } from '@supabase/supabase-js';

const LIMITS = {
  anonymous: 2,    // بدون اکانت
  free:      10,   // نسخه رایگان
  beta:      500,  // beta users — نامحدود عملاً
  pro:       9999, // Pro
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

  // ── Get profile ──
  let plan = userId ? 'free' : 'anonymous';
  let searchCount = 0;

  if (userId) {
    const { data: profile } = await sb
      .from('profiles')
      .select('plan, search_count, is_beta')
      .eq('id', userId)
      .single();

    if (profile) {
      // beta users → plan=beta
      plan = profile.is_beta ? 'beta' : (profile.plan || 'free');
      searchCount = profile.search_count || 0;
    } else {
      // profile نداره → بساز
      await sb.from('profiles').upsert({
        id: userId, plan: 'free', word_count: 0, search_count: 0, is_beta: false
      });
    }
  }

  const limit = LIMITS[plan] ?? LIMITS.free;

  // ── Check limit ──
  if (searchCount >= limit) {
    const isPro = plan === 'pro';
    const msg = plan === 'free'
      ? `${limit} جستجوی رایگان تموم شد. برای ادامه Pro بگیر — فقط €4.99 در ماه.`
      : `سقف جستجو تموم شد.`;
    return res.status(429).json({
      error: 'rate_limit', plan, limit, used: searchCount, remaining: 0, message: msg,
    });
  }

  // ── Validate ──
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
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: err });
    }

    const data = await upstream.json();

    // ── Increment ──
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
