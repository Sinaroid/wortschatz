/**
 * /api/notify.js — Vercel Cron Job
 * هر روز ساعت 17:00 UTC (≈ 20:30 تهران) اجرا میشه
 * Supabase Edge Function رو صدا میزنه
 */
export const config = {
  runtime: 'edge',
}

export default async function handler(req) {
  // فقط از cron یا با secret
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const functionUrl = `${supabaseUrl}/functions/v1/send-notifications`

  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cronSecret}`,
      'Content-Type': 'application/json',
    },
  })

  const data = await res.json()

  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
