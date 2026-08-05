/**
 * ⚡ iGadget — Колесо Фортуны (Cloudflare Workers)
 * D1 = данные, R2 = картинки (фолбэк — Telegraph), grammY = бот через webhook
 */
import { Bot, InlineKeyboard } from 'grammy';

/* Глобальные переменные: у Worker-деплоя все запросы видят одинаковые
   bindings, поэтому такой способ безопасен и упрощает код. */
let ENV = null;        // биндинги wrangler
let APP_ORIGIN = '';   // https://ваш-воркер.workers.dev
let bot = null;

/* ================= ХЕЛПЕРЫ ================= */
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

const enc = new TextEncoder();
const toHex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const clampPercent = v => Math.min(100, Math.max(0, Number(v) || 0));

async function hmacSha256(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/* ================= Telegram initData ================= */
async function parseInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
    const checkString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = await hmacSha256(enc.encode('WebAppData'), ENV.BOT_TOKEN);
    if (toHex(await hmacSha256(secret, checkString)) !== hash) return null;
    return JSON.parse(params.get('user') || 'null');
  } catch { return null; }
}

async function getUser(request) {
  const user = await parseInitData(request.headers.get('X-Init-Data') || '');
  if (user) return user;
  if (!ENV.BOT_TOKEN) return { id: 1, first_name: 'Dev', username: 'dev' };
  return null;
}

const adminIds = () => String(ENV.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);

async function requireAdmin(request) {
  const pwd = request.headers.get('X-Admin-Password');
  if (ENV.ADMIN_PASSWORD && pwd && pwd === ENV.ADMIN_PASSWORD) return { id: 0 };
  const user = await getUser(request);
  if (user && adminIds().includes(user.id)) return user;
  return null;
}

/* ================= КАРТИНКИ: R2 или Telegraph ================= */
async function saveImage(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (ENV.IMAGES) {
    const key = crypto.randomUUID();
    await ENV.IMAGES.put(key, bytes, { httpMetadata: { contentType: file.type || 'image/png' } });
    return 'r2:' + key;
  }
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: file.type || 'image/jpeg' }), 'prize.jpg');
  const r = await fetch('https://telegra.ph/upload', { method: 'POST', body: fd });
  const d = await r.json();
  if (d?.[0]?.src) return 'https://telegra.ph' + d[0].src;
  throw new Error('Не удалось сохранить картинку');
}

const imgUrl = img => !img ? null : img.startsWith('r2:') ? '/uploads/' + img.slice(3) : img;

async function deleteImage(img) {
  if (img?.startsWith('r2:') && ENV.IMAGES) await ENV.IMAGES.delete(img.slice(3));
}

/* ================= БАЗА ================= */
async function activePrizes() {
  const { results } = await ENV.DB.prepare(
    'SELECT * FROM prizes WHERE active = 1 AND (stock = 0 OR stock > 0) ORDER BY rowid').all();
  return results;
}

const dayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };

async function spinsToday(userId) {
  const r = await ENV.DB.prepare('SELECT COUNT(*) AS c FROM wins WHERE user_id = ? AND at >= ?')
    .bind(userId, dayStart()).first();
  return r?.c || 0;
}

/* ================= ПУБЛИЧНОЕ API ================= */
async function apiPrizes() {
  const rows = await activePrizes();
  return json(rows.map(p => ({
    id: p.id, name: p.name, emoji: p.emoji || '🎁', stock: p.stock, image: imgUrl(p.image),
  })));
}

async function apiMe(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Откройте приложение в Telegram' }, 403);
  const limit = Number(ENV.DAILY_SPIN_LIMIT || 3);
  return json({ name: user.first_name, left: Math.max(0, limit - await spinsToday(user.id)) });
}

async function apiSpin(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Откройте приложение в Telegram' }, 403);

  const wheel = await activePrizes();
  if (!wheel.length) return json({ error: 'Призы на колесе закончились' }, 400);

  const limit = Number(ENV.DAILY_SPIN_LIMIT || 3);
  const done = await spinsToday(user.id);
  if (done >= limit)
    return json({ error: 'На сегодня спины закончились 🙌 Возвращайтесь завтра!', left: 0 }, 429);

  // Розыгрыш по процентам (нормализация, если сумма != 100)
  const totalP = wheel.reduce((s, p) => s + (p.percent || 0), 0);
  let winner;
  if (totalP <= 0) winner = wheel[Math.floor(Math.random() * wheel.length)];
  else {
    let r = Math.random() * totalP; winner = wheel[0];
    for (const p of wheel) { r -= (p.percent || 0); if (r <= 0) { winner = p; break; } }
  }

  const stmts = [
    ENV.DB.prepare('INSERT INTO wins (user_id, username, prize_id, prize_name, at) VALUES (?,?,?,?,?)')
      .bind(user.id, user.username || user.first_name || String(user.id), winner.id, winner.name, Date.now()),
  ];
  if (winner.stock > 0)
    stmts.push(ENV.DB.prepare('UPDATE prizes SET stock = stock - 1 WHERE id = ? AND stock > 0').bind(winner.id));
  await ENV.DB.batch(stmts);

  return json({
    index: wheel.findIndex(p => p.id === winner.id),
    prize: { name: winner.name, image: imgUrl(winner.image) },
    left: limit - done - 1,
  });
}

/* ================= АДМИН API ================= */
async function apiAdminPrizes() {
  const { results } = await ENV.DB.prepare('SELECT * FROM prizes ORDER BY rowid').all();
  return json(results.map(p => ({ ...p, active: !!p.active, image: imgUrl(p.image) })));
}

async function apiCreatePrize(request) {
  const form = await request.formData();
  const name = String(form.get('name') || '').trim();
  if (!name) return json({ error: 'Укажите название приза' }, 400);
  const file = form.get('image');
  const image = (file && file.size) ? await saveImage(file) : null;
  const id = crypto.randomUUID();
  await ENV.DB.prepare(
    'INSERT INTO prizes (id, name, emoji, percent, stock, active, image, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, name, String(form.get('emoji') || '🎁').trim(),
      clampPercent(form.get('percent')),
      Math.max(0, Number(form.get('stock')) || 0),
      String(form.get('active')) !== 'false' ? 1 : 0,
      image, Date.now()).run();
  return json({ id });
}

async function apiUpdatePrize(request, id) {
  const exists = await ENV.DB.prepare('SELECT * FROM prizes WHERE id = ?').bind(id).first();
  if (!exists) return json({ error: 'Приз не найден' }, 404);
  const form = await request.formData();
  const p = { ...exists };
  const name = form.get('name');
  if (name && String(name).trim()) p.name = String(name).trim();
  if (form.get('emoji') !== null) p.emoji = String(form.get('emoji')).trim() || '🎁';
  if (form.get('percent') !== null) p.percent = clampPercent(form.get('percent'));
  if (form.get('stock') !== null) p.stock = Math.max(0, Number(form.get('stock')) || 0);
  if (form.get('active') !== null) p.active = String(form.get('active')) === 'true' ? 1 : 0;
  const file = form.get('image');
  if (file && file.size) {
    await deleteImage(exists.image);
    p.image = await saveImage(file);
  }
  await ENV.DB.prepare('UPDATE prizes SET name=?, emoji=?, percent=?, stock=?, active=?, image=? WHERE id=?')
    .bind(p.name, p.emoji, p.percent, p.stock, p.active, p.image, id).run();
  return json({ ...p, active: !!p.active });
}

async function apiDeletePrize(id) {
  const exists = await ENV.DB.prepare('SELECT * FROM prizes WHERE id = ?').bind(id).first();
  if (!exists) return json({ error: 'Приз не найден' }, 404);
  await ENV.DB.prepare('DELETE FROM prizes WHERE id = ?').bind(id).run();
  await deleteImage(exists.image);
  return json({ ok: true });
}

async function apiStats() {
  const total = (await ENV.DB.prepare('SELECT COUNT(*) AS c FROM wins').first())?.c || 0;
  const { results: by } = await ENV.DB.prepare(
    'SELECT prize_name, COUNT(*) AS c FROM wins GROUP BY prize_name').all();
  const { results: recent } = await ENV.DB.prepare(
    'SELECT username, prize_name, at FROM wins ORDER BY id DESC LIMIT 50').all();
  const byPrize = {};
  by.forEach(r => { byPrize[r.prize_name] = r.c; });
  return json({ totalSpins: total, byPrize, recent });
}

/* ================= БОТ ================= */
function initBot() {
  if (bot) return bot;
  bot = new Bot(ENV.BOT_TOKEN);

  const wheelKb = () => new InlineKeyboard().webApp('🎡 Крутить колесо', APP_ORIGIN);

  bot.command('start', ctx => ctx.reply(
    '⚡️ <b>iGadget • Колесо Фортуны</b>\n\nКрути колесо и забирай призы: скидки, промокоды и гаджеты 🎁',
    { parse_mode: 'HTML', reply_markup: wheelKb() },
  ));

  bot.command('admin', ctx => {
    if (!adminIds().includes(ctx.from.id)) return ctx.reply('⛔ Команда доступна только администраторам.');
    return ctx.reply('🛠 Панель управления колесом:', {
      reply_markup: new InlineKeyboard().webApp('⚙️ Открыть админку', `${APP_ORIGIN}/admin.html`),
    });
  });

  bot.on('message:text', ctx => {
    if (ctx.message.text?.startsWith('/')) return;
    return ctx.reply('Жми кнопку ниже и испытай удачу 🍀', { reply_markup: wheelKb() });
  });

  bot.catch(err => console.error('Bot error:', err));
  return bot;
}

async function apiSetup(request, origin) {
  const admin = await requireAdmin(request);
  if (!admin) return json({ error: 'Нет доступа' }, 403);
  if (!ENV.BOT_TOKEN) return json({ error: 'BOT_TOKEN не задан' }, 400);
  await initBot().api.setWebhook(`${origin}/telegram/webhook`, {
    secret_token: ENV.WEBHOOK_SECRET,
    allowed_updates: ['message'],
  });
  return json({ ok: true, webhook: `${origin}/telegram/webhook` });
}

/* ================= РОУТЕР ================= */
export default {
  async fetch(request, env) {
    ENV = env;
    const url = new URL(request.url);
    APP_ORIGIN = url.origin;
    const p = url.pathname;
    const m = request.method;

    try {
      /* Webhook бота */
      if (p === '/telegram/webhook') {
        if (m !== 'POST') return new Response('Method Not Allowed', { status: 405 });
        if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET)
          return new Response('Forbidden', { status: 403 });
        await initBot().handleUpdate(await request.json());
        return new Response('ok');
      }

      /* Картинки из R2 */
      if (p.startsWith('/uploads/')) {
        if (!env.IMAGES) return new Response('R2 не настроен', { status: 404 });
        const obj = await env.IMAGES.get(p.slice('/uploads/'.length));
        if (!obj) return new Response('Not Found', { status: 404 });
        return new Response(obj.body, {
          headers: {
            'Content-Type': obj.httpMetadata?.contentType || 'image/png',
            'Cache-Control': 'public, max-age=604800',
          },
        });
      }

      if (p === '/admin') return Response.redirect(`${url.origin}/admin.html`, 302);

      /* Публичное API */
      if (p === '/api/prizes' && m === 'GET') return await apiPrizes();
      if (p === '/api/me' && m === 'GET') return await apiMe(request);
      if (p === '/api/spin' && m === 'POST') return await apiSpin(request);

      /* Админ API */
      if (p.startsWith('/api/admin/')) {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: 'Нет доступа' }, 403);
        if (p === '/api/admin/prizes' && m === 'GET') return await apiAdminPrizes();
        if (p === '/api/admin/prizes' && m === 'POST') return await apiCreatePrize(request);
        if (p === '/api/admin/stats' && m === 'GET') return await apiStats();
        const match = p.match(/^\/api\/admin\/prizes\/([\w-]+)$/);
        if (match) {
          if (m === 'PUT') return await apiUpdatePrize(request, match[1]);
          if (m === 'DELETE') return await apiDeletePrize(match[1]);
        }
      }

      /* Подключение вебхука (один раз после деплоя) */
      if (p === '/api/setup' && m === 'POST') return await apiSetup(request, url.origin);

      return new Response('Not Found', { status: 404 });
    } catch (e) {
      console.error(e);
      return json({ error: 'Ошибка сервера' }, 500);
    }
  },
};
