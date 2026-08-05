CREATE TABLE IF NOT EXISTS prizes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '🎁',
  percent REAL DEFAULT 0,
  stock INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  image TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS wins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT,
  prize_id TEXT,
  prize_name TEXT,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wins_user ON wins (user_id, at);

-- Демо-призы (сумма = 100%). Лишние потом удалите через админку.
INSERT INTO prizes (id, name, emoji, percent, stock, active, image, created_at) VALUES
 ('demo-1', 'Скидка 10%',        '💸', 30, 0,  1, NULL, strftime('%s','now')*1000),
 ('demo-2', 'Стикеры',           '🎨', 25, 0,  1, NULL, strftime('%s','now')*1000),
 ('demo-3', 'Промокод',          '🎁', 20, 0,  1, NULL, strftime('%s','now')*1000),
 ('demo-4', 'Чехол для смартфона','📱', 12, 10, 1, NULL, strftime('%s','now')*1000),
 ('demo-5', 'Ещё попытка',       '🔄', 8,  0,  1, NULL, strftime('%s','now')*1000),
 ('demo-6', 'Наушники',          '🎧', 5,  3,  1, NULL, strftime('%s','now')*1000);
