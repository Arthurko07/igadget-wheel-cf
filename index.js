/**
 * ⚡ iGadget — Колесо Фортуны (Telegram Mini App)
 * Версии 1.1: вероятности призов задаются в процентах
 */
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { Bot, InlineKeyboard } = require('grammy');

/* ================= НАСТРОЙКИ (env) ================= */
const BOT_TOKEN        = process.env.BOT_TOKEN || '';
const APP_URL          = (process.env.APP_URL || '').replace(/\/$/, '');
const ADMIN_IDS        = (process.env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);
const ADMIN_PASSWORD   = process.env.ADMIN_PASSWORD || '';
const DAILY_SPIN_LIMIT = Number(process.env.DAILY_SPIN_LIMIT || 3);
const PORT             = Number(process.env.PORT || 3000);

/* ================= ДАННЫЕ ================= */
const DB_PATH = path.join(__dirname, 'db.json');
let db = { prizes: [], wins: [] };
try { db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) {}
const saveDb = () => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

// Демо-призы (сумма = 100%)
if (!db.prizes.length) {
  const demo = [
    ['Скидка 10%', '💸', 30, 0],
    ['Стикеры', '🎨', 25, 0],
    ['Промокод', '🎁', 20, 0],
    ['Чехол для смартфона', '📱', 12, 10],
    ['Ещё попытка', '🔄', 8, 0],
    ['Наушники', '🎧', 5, 3],
  ];
  db.prizes = demo.map(([name, emoji, percent, stock]) => ({
    id: crypto.randomUUID(), name, emoji, percent, stock, active: true, image: null, createdAt: Date.now(),
  }));
  saveDb();
}

// Авто-миграция со старых "весов" на проценты
if (db.prizes.some(p => p.percent === undefined)) {
  const tw = db.prizes.reduce((s, p) => s + (Number(p.weight) || 1), 0);
  db.prizes.forEach(p => {
    if (p.percent === undefined) {
      p.percent = Math.round(((Number(p.weight) || 1) / tw) * 1000) / 10;
      delete p.weight;
    }
  });
  saveDb();
}

/* ================= ЗАГРУЗКА КАРТИНОК ================= */
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) =>
    cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname)),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)),
});

/* ================= Telegram initData ================= */
function parseInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const check  = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (check !== hash) return null;
    return JSON.parse(params.get('user') || 'null');
  } catch (e) { return null; }
}

function getUser(req) {
  const user = parseInitData(req.header('X-Init-Data') || '');
  if (user) return user;
  if (!BOT_TOKEN) return { id: 1, first_name: 'Dev', username: 'dev' };
  return null;
}

function requireAdmin(req, res, next) {
  const pwd = req.header('X-Admin-Password');
  if (ADMIN_PASSWORD && pwd && pwd === ADMIN_PASSWORD) { req.admin = { id: 0 }; return next(); }
  const user = getUser(req);
  if (user && ADMIN_IDS.includes(user.id)) { req.admin = user; return next(); }
  return res.status(403).json({ error: 'Нет доступа' });
}

/* ================= EXPRESS ================= */
const app = express();
app.use(express.json());
app.use('/uploads', express.static(uploadDir, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.redirect('/admin.html'));

const activePrizes = () => db.prizes.filter(p => p.active && (p.stock === 0 || p.stock > 0));
const spinsToday = (userId) => {
  const today = new Date().toDateString();
  return db.wins.filter(w => w.userId === userId && new Date(w.at).toDateString() === today).length;
};
const clampPercent = v => Math.min(100, Math.max(0, Number(v) || 0));

/* ---------- Публичное API ---------- */
app.get('/api/prizes', (req, res) => {
  res.json(activePrizes().map(p => ({
    id: p.id, name: p.name, emoji: p.emoji || '🎁', stock: p.stock,
    image: p.image ? `/uploads/${p.image}` : null,
  })));
});

app.get('/api/me', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(403).json({ error: 'Откройте приложение в Telegram' });
  res.json({ name: user.first_name, left: Math.max(0, DAILY_SPIN_LIMIT - spinsToday(user.id)) });
});

app.post('/api/spin', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(403).json({ error: 'Откройте приложение в Telegram' });

  const wheel = activePrizes();
  if (!wheel.length) return res.status(400).json({ error: 'Призы на колесе закончились' });

  const done = spinsToday(user.id);
  if (done >= DAILY_SPIN_LIMIT)
    return res.status(429).json({ error: 'На сегодня спины закончились 🙌 Возвращайтесь завтра!', left: 0 });

  // Выбор по процентам. Если сумма != 100 — нормализуем пропорционально.
  const totalP = wheel.reduce((s, p) => s + (Number(p.percent) || 0), 0);
  let winner;
  if (totalP <= 0) {
    winner = wheel[Math.floor(Math.random() * wheel.length)];
  } else {
    let r = Math.random() * totalP;
    winner = wheel[0];
    for (const p of wheel) { r -= (Number(p.percent) || 0); if (r <= 0) { winner = p; break; } }
  }

  if (winner.stock > 0) winner.stock--;
  db.wins.push({
    userId: user.id,
    username: user.username || user.first_name || String(user.id),
    prizeId: winner.id, prizeName: winner.name, at: Date.now(),
  });
  saveDb();

  res.json({
    index: wheel.findIndex(p => p.id === winner.id),
    prize: { name: winner.name, image: winner.image ? `/uploads/${winner.image}` : null },
    left: DAILY_SPIN_LIMIT - done - 1,
  });
});

/* ---------- Админ API ---------- */
app.get('/api/admin/prizes', requireAdmin, (req, res) => res.json(db.prizes));

app.post('/api/admin/prizes', requireAdmin, upload.single('image'), (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название приза' });
  const prize = {
    id: crypto.randomUUID(),
    name: name.trim(),
    emoji: (req.body.emoji || '🎁').trim(),
    percent: clampPercent(req.body.percent),
    stock: Math.max(0, Number(req.body.stock) || 0),
    active: String(req.body.active) !== 'false',
    image: req.file ? req.file.filename : null,
    createdAt: Date.now(),
  };
  db.prizes.push(prize); saveDb();
  res.json(prize);
});

app.put('/api/admin/prizes/:id', requireAdmin, upload.single('image'), (req, res) => {
  const p = db.prizes.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Приз не найден' });
  const b = req.body;
  if (b.name !== undefined && b.name.trim()) p.name = b.name.trim();
  if (b.emoji !== undefined) p.emoji = b.emoji.trim() || '🎁';
  if (b.percent !== undefined) p.percent = clampPercent(b.percent);
  if (b.stock !== undefined) p.stock = Math.max(0, Number(b.stock) || 0);
  if (b.active !== undefined) p.active = String(b.active) === 'true';
  if (req.file) {
    if (p.image) fs.unlink(path.join(uploadDir, p.image), () => {});
    p.image = req.file.filename;
  }
  saveDb();
  res.json(p);
});

app.delete('/api/admin/prizes/:id', requireAdmin, (req, res) => {
  const i = db.prizes.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Приз не найден' });
  const [p] = db.prizes.splice(i, 1);
  if (p.image) fs.unlink(path.join(uploadDir, p.image), () => {});
  saveDb();
  res.json({ ok: true });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const byPrize = {};
  for (const w of db.wins) byPrize[w.prizeName] = (byPrize[w.prizeName] || 0) + 1;
  res.json({ totalSpins: db.wins.length, byPrize, recent: db.wins.slice(-50).reverse() });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError)
    return res.status(400).json({ error: 'Картинка слишком большая (макс. 5 МБ)' });
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

app.listen(PORT, () => console.log(`🌐 Сервер: http://localhost:${PORT}`));

/* ================= БОТ ================= */
if (BOT_TOKEN) {
  const bot = new Bot(BOT_TOKEN);
  const wheelKb = () => new InlineKeyboard().webApp('🎡 Крутить колесо', APP_URL || 'https://telegram.org');

  bot.command('start', ctx => ctx.reply(
    '⚡️ <b>iGadget • Колесо Фортуны</b>\n\nКрути колесо и забирай призы: скидки, промокоды и гаджеты 🎁',
    { parse_mode: 'HTML', reply_markup: wheelKb() },
  ));

  bot.on('message:text', ctx => {
    if (ctx.message.text?.startsWith('/')) return;
    return ctx.reply('Жми кнопку ниже и испытай удачу 🍀', { reply_markup: wheelKb() });
  });

  bot.command('admin', ctx => {
    if (!ADMIN_IDS.includes(ctx.from.id)) return ctx.reply('⛔ Команда доступна только администраторам.');
    return ctx.reply('🛠 Панель управления колесом:', {
      reply_markup: new InlineKeyboard().webApp('⚙️ Открыть админку', `${APP_URL}/admin.html`),
    });
  });

  bot.catch(err => console.error('Bot error:', err));
  bot.start({ onStart: me => console.log(`🤖 Бот @${me.username} запущен`) });
} else {
  console.log('⚠️  BOT_TOKEN не задан — запущен только веб-сервер (dev-режим).');
}
