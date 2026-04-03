/**
 * /api/telegram.js — Telegram Bot Webhook
 * دریافت پیام‌های تلگرام و ذخیره chat_id برای notifications
 */
export const config = { runtime: 'edge' }

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN
const SB_URL      = process.env.SUPABASE_URL
const SB_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET

async function sendMessage(chatId, text, markup) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' }
  if (markup) body.reply_markup = markup
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function sbQuery(endpoint, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${endpoint}`, {
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
      ...options.headers,
    },
    ...options,
  })
  if (res.status !== 204) return res.json()
  return null
}

export default async function handler(req) {
  // verify secret
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  if (secret !== WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 403 })
  }

  const update = await req.json()
  const msg = update.message || update.callback_query?.message
  if (!msg) return new Response('ok')

  const chatId   = msg.chat.id
  const userId   = msg.from.id
  const text     = msg.text || ''
  const firstName = msg.from.first_name || 'دوست'

  // /start — باز کردن mini app
  if (text.startsWith('/start')) {
    await sendMessage(chatId,
      `سلام ${firstName}! 👋\n\nبه Wortschatz خوش اومدی 🇩🇪\n\nیادگیری لغت آلمانی با AI — سریع و هوشمند.`,
      {
        inline_keyboard: [[
          { text: '🚀 باز کردن Wortschatz', web_app: { url: 'https://wortschatz.space' } }
        ]]
      }
    )
    return new Response('ok')
  }

  // /notify — فعال کردن notification
  if (text.startsWith('/notify')) {
    // پیدا کردن user در Supabase بر اساس tg_id
    const users = await sbQuery(
      `profiles?select=id&tg_id=eq.${userId}`,
      { method: 'GET', headers: { 'tg_id': `eq.${userId}` } }
    )

    // جستجو در user metadata
    const authRes = await fetch(`${SB_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    })
    const authData = await authRes.json()
    const matchedUser = authData.users?.find(u =>
      u.user_metadata?.tg_id === String(userId)
    )

    if (!matchedUser) {
      await sendMessage(chatId,
        `برای فعال کردن notification، اول از داخل app وارد شو:\n\n👇`,
        {
          inline_keyboard: [[
            { text: '🔑 ورود به Wortschatz', web_app: { url: 'https://wortschatz.space' } }
          ]]
        }
      )
      return new Response('ok')
    }

    // ذخیره chat_id
    await sbQuery('notifications', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: matchedUser.id,
        telegram_chat_id: chatId,
        enabled: true,
        hour: 17, // UTC 17 = Tehran 20:30
      })
    })

    await sendMessage(chatId,
      `✅ <b>Notification فعال شد!</b>\n\nهر روز ساعت ۸:۳۰ شب یادآوری می‌فرستم که لغاتت رو مرور کنی.\n\n/off_notify برای خاموش کردن`,
    )
    return new Response('ok')
  }

  // /off_notify — غیرفعال کردن
  if (text.startsWith('/off_notify')) {
    await sbQuery(`notifications?telegram_chat_id=eq.${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false })
    })
    await sendMessage(chatId, '🔕 Notification خاموش شد.\n\n/notify برای فعال کردن مجدد.')
    return new Response('ok')
  }

  // پیام نامشخص
  await sendMessage(chatId,
    `دستورات:\n/start — باز کردن app\n/notify — فعال کردن یادآوری روزانه\n/off_notify — خاموش کردن`,
    {
      inline_keyboard: [[
        { text: '📖 باز کردن Wortschatz', web_app: { url: 'https://wortschatz.space' } }
      ]]
    }
  )

  return new Response('ok')
}
