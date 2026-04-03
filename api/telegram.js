const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL = 'https://wortschatz.space'

const E = {
  warn:    '<tg-emoji emoji-id="5447644880824181073">⚠️</tg-emoji>',
  smile:   '<tg-emoji emoji-id="5461117441612462242">🙂</tg-emoji>',
  zap:     '<tg-emoji emoji-id="5456140674028019486">⚡️</tg-emoji>',
  search:  '<tg-emoji emoji-id="5188217332748527444">🔍</tg-emoji>',
  folder:  '<tg-emoji emoji-id="5433653135799228968">📁</tg-emoji>',
  bell:    '<tg-emoji emoji-id="5280922999241859582">🔔</tg-emoji>',
  nobell:  '<tg-emoji emoji-id="5260293700088935305">🔕</tg-emoji>',
  clock:   '<tg-emoji emoji-id="5413704112220949842">⏰</tg-emoji>',
  gem:     '<tg-emoji emoji-id="5231200819986047254">💎</tg-emoji>',
  fire:    '<tg-emoji emoji-id="5199778225158562097">🔥</tg-emoji>',
  chart_up:'<tg-emoji emoji-id="5197023338074566929">📈</tg-emoji>',
  green:   '<tg-emoji emoji-id="5197392703007793263">🟢</tg-emoji>',
  arrow:   '<tg-emoji emoji-id="5197512102619048748">➡️</tg-emoji>',
  star:    '<tg-emoji emoji-id="5199785826172428773">✨</tg-emoji>',
  crown:   '<tg-emoji emoji-id="5199973698344030158">👑</tg-emoji>',
  idea:    '<tg-emoji emoji-id="5200074733783928015">💡</tg-emoji>',
  party:   '<tg-emoji emoji-id="5200407600325997312">🎉</tg-emoji>',
}
const tg = k => E[k] || ''

async function send(chatId, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra }),
  })
}

async function setMenuButton(chatId) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, menu_button: { type: 'web_app', text: '🇩🇪 Wortschatz', web_app: { url: APP_URL } } }),
  })
}

const MAIN_KB = {
  keyboard: [
    [{ text: '🚀 باز کردن Wortschatz', web_app: { url: APP_URL }, style: 'primary' }],
    [{ text: '🔔 یادآوری', style: 'success' }, { text: '🔕 خاموش کردن', style: 'danger' }],
    [{ text: '📊 آمار من' }, { text: '❓ راهنما' }],
  ],
  resize_keyboard: true,
  persistent: true,
}

async function sbFetch(path, options = {}) {
  const headers = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...options.headers }
  return fetch(`${SB_URL}${path}`, { ...options, headers })
}

async function findUser(tgId) {
  const res = await sbFetch('/auth/v1/admin/users?page=1&per_page=1000')
  const data = await res.json()
  return data.users?.find(u => u.user_metadata?.tg_id === String(tgId))
}

async function saveNotif(userId, chatId) {
  await sbFetch('/rest/v1/notifications', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: userId, telegram_chat_id: chatId, enabled: true, hour: 17 }),
  })
}

async function disableNotif(chatId) {
  await sbFetch(`/rest/v1/notifications?telegram_chat_id=eq.${chatId}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  })
}

async function getUserStats(userId) {
  const [wRes, pRes, nRes] = await Promise.all([
    sbFetch(`/rest/v1/words?user_id=eq.${userId}&select=id,next_review,score`),
    sbFetch(`/rest/v1/profiles?id=eq.${userId}&select=*`),
    sbFetch(`/rest/v1/notifications?user_id=eq.${userId}&select=enabled`),
  ])
  const [words, profiles, notifs] = await Promise.all([wRes.json(), pRes.json(), nRes.json()])
  const now = new Date().toISOString()
  const due = Array.isArray(words) ? words.filter(w => w.next_review <= now).length : 0
  const total = Array.isArray(words) ? words.length : 0
  const learned = Array.isArray(words) ? words.filter(w => (w.score || 0) >= 3).length : 0
  const profile = Array.isArray(profiles) ? profiles[0] : null
  const notifEnabled = Array.isArray(notifs) && notifs.length > 0 && notifs[0].enabled
  return { total, due, learned, plan: profile?.plan || 'free', level: profile?.level || 'B1', notifEnabled }
}

function progressBar(val, max, len = 10) {
  const f = max > 0 ? Math.round((val / max) * len) : 0
  return '█'.repeat(f) + '░'.repeat(len - f)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('ok')
  }

  const update = req.body
  const msg = update?.message
  if (!msg) return res.status(200).send('ok')

  const chatId = msg.chat.id
  const tgId = msg.from.id
  const text = (msg.text || '').trim()
  const name = msg.from.first_name || 'دوست'

  try {
    if (text === '/start' || text.startsWith('/start ')) {
      await setMenuButton(chatId)
      await send(chatId,
        `${tg('smile')} سلام <b>${name}</b>!\n\n` +
        `<blockquote>${tg('zap')} <b>Wortschatz</b> — یادگیری لغت آلمانی با هوش مصنوعی</blockquote>\n\n` +
        `${tg('search')} هر لغت رو سرچ کن — <i>AI معنی، سطح، مثال و نکته گرامری بهت میده</i>\n` +
        `${tg('folder')} فلش‌کارت بساز — <i>الگوریتم یادت میاره کِی مرور کنی</i>\n` +
        `${tg('bell')} یادآوری روزانه — <i>هر شب ساعت ۸:۳۰ پیام میدم</i>\n\n` +
        `${tg('arrow')} از منوی پایین شروع کن`,
        { reply_markup: MAIN_KB }
      )
    } else if (text === '🔔 یادآوری' || text === '/notify') {
      const user = await findUser(tgId)
      if (!user) {
        await send(chatId,
          `<blockquote>${tg('warn')} اول باید وارد اپ بشی</blockquote>\nبعد از ورود، دوباره بزن.`,
          { reply_markup: { inline_keyboard: [[{ text: '🔑 ورود', web_app: { url: APP_URL } }]] } }
        )
      } else {
        await saveNotif(user.id, chatId)
        await send(chatId,
          `${tg('green')} <b>یادآوری روزانه فعال شد!</b>\n\n` +
          `<blockquote>${tg('bell')} هر شب ساعت ۸:۳۰ یادآوری میفرستم</blockquote>`,
          { reply_markup: MAIN_KB }
        )
      }
    } else if (text === '🔕 خاموش کردن' || text === '/off_notify') {
      await disableNotif(chatId)
      await send(chatId,
        `${tg('nobell')} <b>یادآوری خاموش شد.</b>`,
        { reply_markup: MAIN_KB }
      )
    } else if (text === '📊 آمار من' || text === '/stats') {
      const user = await findUser(tgId)
      if (!user) {
        await send(chatId, `<blockquote>${tg('warn')} اول وارد اپ بشی</blockquote>`,
          { reply_markup: { inline_keyboard: [[{ text: '🔑 ورود', web_app: { url: APP_URL } }]] } }
        )
      } else {
        const s = await getUserStats(user.id)
        const pct = s.total > 0 ? Math.round((s.learned / s.total) * 100) : 0
        const bar = progressBar(s.learned, s.total)
        const planBadge = s.plan === 'pro' ? `${tg('crown')} Pro` : `${tg('green')} Free`
        const notifBadge = s.notifEnabled ? `${tg('bell')} فعال` : `${tg('nobell')} غیرفعال`
        const dueLine = s.due > 0 ? `\n\n${tg('fire')} امروز <b>${s.due} لغت</b> باید مرور بشن!` : `\n\n${tg('party')} <b>همه لغاتت رو مرور کردی!</b>`
        await send(chatId,
          `${tg('chart_up')} <b>آمار ${name}</b>\n\n` +
          `<blockquote>🎓 یادگیری: <b>${s.learned}</b> از <b>${s.total}</b> لغت\n${bar} ${pct}%</blockquote>\n\n` +
          `${tg('clock')} امروز: <b>${s.due}</b> لغت\n` +
          `${tg('zap')} سطح: <b>${s.level}</b>\n` +
          `${tg('gem')} پلن: <b>${planBadge}</b>\n` +
          `${tg('bell')} یادآوری: <b>${notifBadge}</b>` + dueLine,
          { reply_markup: { inline_keyboard: [[{ text: s.due > 0 ? `▶️ شروع مرور (${s.due} لغت)` : '📚 دیدن لغات', web_app: { url: APP_URL } }]] } }
        )
      }
    } else if (text === '❓ راهنما' || text === '/help') {
      await send(chatId,
        `${tg('idea')} <b>راهنمای Wortschatz</b>\n\n` +
        `<blockquote>🚀 <b>باز کردن</b> — اپ رو مستقیم باز کن\n` +
        `${tg('bell')} <b>یادآوری</b> — هر شب ساعت ۸:۳۰\n` +
        `${tg('chart_up')} <b>آمار من</b> — وضعیت یادگیریت\n` +
        `${tg('nobell')} <b>خاموش کردن</b> — یادآوری رو خاموش کن</blockquote>`,
        { reply_markup: MAIN_KB }
      )
    } else {
      await send(chatId, `${tg('arrow')} از منوی پایین استفاده کن`, { reply_markup: MAIN_KB })
    }
  } catch (e) {
    console.error('telegram handler error:', e)
  }

  return res.status(200).send('ok')
}
