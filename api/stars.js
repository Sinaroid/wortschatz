// api/stars.js — Telegram Stars payment for Wortschatz Pro
// POST /api/stars → sends invoice to user via Telegram

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

// Pro = 250 Stars (~$5)
const STARS_PRICE = 250
const PRODUCT_TITLE = 'Wortschatz Pro'
const PRODUCT_DESC = 'جستجوی نامحدود + همه pack ها + sync روی همه دستگاه‌ها'
const PAYLOAD = 'pro_monthly'

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const userId = req.headers['x-user-id'] || req.body?.user_id
  const tgChatId = req.body?.tg_chat_id

  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not configured' })
  }

  if (!tgChatId) {
    return res.status(400).json({ error: 'tg_chat_id required' })
  }

  try {
    // send Stars invoice via Telegram Bot API
    const invoiceRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendInvoice`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgChatId,
          title: PRODUCT_TITLE,
          description: PRODUCT_DESC,
          payload: PAYLOAD,
          currency: 'XTR', // Telegram Stars
          prices: [{ label: 'Pro ماهانه', amount: STARS_PRICE }],
          // optional: photo
          photo_url: 'https://wortschatz.space/icon-512.png',
          photo_width: 512,
          photo_height: 512,
          // allow sending to same user
          protect_content: false,
        }),
      }
    )

    const invoiceData = await invoiceRes.json()

    if (!invoiceData.ok) {
      console.error('Telegram invoice error:', invoiceData)
      return res.status(500).json({ error: 'Failed to send invoice', detail: invoiceData.description })
    }

    return res.status(200).json({ ok: true, message_id: invoiceData.result.message_id, user_id: userId || null })
  } catch (err) {
    console.error('Stars API error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
