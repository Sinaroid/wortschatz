import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { userId, plan, months = 1 } = req.body;
  if (!userId || !plan) return res.status(400).json({ error: 'missing fields' });
  if (!['free','beta','pro'].includes(plan)) return res.status(400).json({ error: 'invalid plan' });

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  let updates = { plan, is_beta: plan === 'beta' };

  if (plan === 'pro') {
    // اگه pro_until داره و هنوز valid هست → از اون اضافه کن
    // اگه نداره یا منقضی شده → از الان شروع کن
    const { data: profile } = await sb
      .from('profiles')
      .select('pro_until')
      .eq('id', userId)
      .single();

    const now = new Date();
    let base = now;

    if (profile?.pro_until) {
      const existing = new Date(profile.pro_until);
      if (existing > now) {
        base = existing; // از آخر اشتراک فعلی اضافه کن
      }
    }

    const proUntil = new Date(base);
    proUntil.setMonth(proUntil.getMonth() + months);
    updates.pro_until = proUntil.toISOString();

    // محاسبه روزهای باقی‌مونده برای response
    const daysAdded = Math.ceil((proUntil - now) / (1000 * 60 * 60 * 24));
    const { error } = await sb.from('profiles').update(updates).eq('id', userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ 
      success: true, 
      pro_until: proUntil.toISOString(),
      days_remaining: daysAdded
    });

  } else {
    updates.pro_until = null;
    const { error } = await sb.from('profiles').update(updates).eq('id', userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }
}
