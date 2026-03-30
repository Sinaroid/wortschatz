// api/checkout.js — Create Stripe checkout session
// ENV: STRIPE_SECRET_KEY, STRIPE_PRICE_ID

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = (req.headers['x-user-id'] || '').trim();
  if (!userId) return res.status(401).json({ error: 'Login required' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const priceId  = process.env.STRIPE_PRICE_ID;
  if (!stripeKey || !priceId) return res.status(500).json({ error: 'Stripe not configured' });

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'payment_method_types[]': 'card',
        'mode': 'subscription',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'success_url': `https://wortschatz-one.vercel.app/?upgrade=success&user_id=${userId}`,
        'cancel_url':  `https://wortschatz-one.vercel.app/?upgrade=cancel`,
        'client_reference_id': userId,
        'metadata[user_id]': userId,
      }),
    });

    const session = await r.json();
    if (session.error) return res.status(400).json({ error: session.error.message });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
