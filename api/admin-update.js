import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Check admin password
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { userId, plan } = req.body;
  if (!userId || !plan) return res.status(400).json({ error: 'missing fields' });
  if (!['free','beta','pro'].includes(plan)) return res.status(400).json({ error: 'invalid plan' });

  // Use service_role key — server side only
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { error } = await sb.from('profiles').update({
    plan,
    is_beta: plan === 'beta'
  }).eq('id', userId);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true });
}
