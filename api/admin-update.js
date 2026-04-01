import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { userId, plan } = req.body;
  if (!userId || !plan) return res.status(400).json({ error: 'missing fields' });
  if (!['free','beta','pro'].includes(plan)) return res.status(400).json({ error: 'invalid plan' });

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // محاسبه pro_until
  let updates = { plan, is_beta: plan === 'beta' };
  if(plan === 'pro'){
    // یه ماه از الان
    const proUntil = new Date();
    proUntil.setMonth(proUntil.getMonth() + 1);
    updates.pro_until = proUntil.toISOString();
  } else {
    updates.pro_until = null;
  }

  const { error } = await sb.from('profiles').update(updates).eq('id', userId);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true });
}
