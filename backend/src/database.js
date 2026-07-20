const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const client = createClient({ url: `file:${path.join(DATA_DIR, 'mediapicker.db')}` });

function rows(result) {
  return result.rows.map(r =>
    Object.fromEntries(result.columns.map((col, i) => [col, r[i]]))
  );
}

const db = {
  all:  async (sql, args = []) => rows(await client.execute({ sql, args })),
  get:  async (sql, args = []) => {
    const r = await client.execute({ sql, args });
    if (!r.rows.length) return null;
    return Object.fromEntries(r.columns.map((col, i) => [col, r.rows[0][i]]));
  },
  run:  async (sql, args = []) => {
    const r = await client.execute({ sql, args });
    return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.rowsAffected };
  },
  exec: async (sql) => {
    const stmts = sql.split(';').map(s => s.trim()).filter(Boolean).map(s => ({ sql: s }));
    await client.batch(stmts, 'write');
  },
};

async function ensureUserSlots(userId) {
  const CATS = ['movies', 'series', 'anime', 'manga', 'games', 'comics', 'albums'];
  for (const cat of CATS) {
    for (let i = 1; i <= 3; i++) {
      await db.run(
        'INSERT OR IGNORE INTO slots (user_id, category, slot_index) VALUES (?, ?, ?)',
        [userId, cat, i]
      );
    }
  }
}

async function migrateToMultiUser() {
  const check = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
  if (check) return;

  console.log('[db] Running multi-user migration…');

  await db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    server_url TEXT NOT NULL DEFAULT '',
    jellyfin_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    expires_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') + 2592000)
  )`);

  try { await db.run("ALTER TABLE library_items ADD COLUMN user_id TEXT NOT NULL DEFAULT 'lilcipra'") } catch {}
  try { await db.run("ALTER TABLE queue_items ADD COLUMN user_id TEXT NOT NULL DEFAULT 'lilcipra'") } catch {}
  try { await db.run("ALTER TABLE ongoing_items ADD COLUMN user_id TEXT NOT NULL DEFAULT 'lilcipra'") } catch {}

  await db.run(`CREATE TABLE settings_new (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key)
  )`);
  await db.run("INSERT INTO settings_new (user_id, key, value) SELECT 'lilcipra', key, value FROM settings");
  await db.run('DROP TABLE settings');
  await db.run('ALTER TABLE settings_new RENAME TO settings');

  await db.run(`CREATE TABLE slots_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'lilcipra',
    category TEXT NOT NULL,
    slot_index INTEGER NOT NULL,
    item_id INTEGER,
    is_locked INTEGER DEFAULT 0,
    note TEXT,
    current_progress INTEGER DEFAULT 0,
    UNIQUE(user_id, category, slot_index)
  )`);
  await db.run(
    "INSERT INTO slots_new (id, user_id, category, slot_index, item_id, is_locked, note, current_progress) SELECT id, 'lilcipra', category, slot_index, item_id, is_locked, note, COALESCE(current_progress, 0) FROM slots"
  );
  await db.run('DROP TABLE slots');
  await db.run('ALTER TABLE slots_new RENAME TO slots');

  await db.run(`CREATE TABLE completion_stats_new (
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    total_progress INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, category)
  )`);
  await db.run(
    "INSERT INTO completion_stats_new (user_id, category, count, total_progress) SELECT 'lilcipra', category, count, COALESCE(total_progress, 0) FROM completion_stats"
  );
  await db.run('DROP TABLE completion_stats');
  await db.run('ALTER TABLE completion_stats_new RENAME TO completion_stats');

  // Only pre-create the lilcipra user if there's existing data to own
  const hasData = await db.get('SELECT id FROM library_items LIMIT 1');
  if (hasData) {
    await db.run("INSERT OR IGNORE INTO users (username, server_url) VALUES ('lilcipra', '')");
    console.log('[db] Existing data assigned to user: lilcipra');
  }

  // Add expires_at to sessions if table already existed without it
  try { await db.run("ALTER TABLE sessions ADD COLUMN expires_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') + 2592000)") } catch {}

  console.log('[db] Multi-user migration complete');
}

async function cleanExpiredSessions() {
  const now = Math.floor(Date.now() / 1000);
  const r = await db.run('DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < ?', [now]);
  if (r.changes > 0) console.log(`[db] Pruned ${r.changes} expired session(s)`);
}

async function init() {
  // Initial schema — kept at old shape so IF NOT EXISTS is a no-op on existing DBs.
  // migrateToMultiUser() rewrites these tables to the multi-user schema on first run.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS library_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      external_id TEXT,
      thumbnail_url TEXT,
      metadata TEXT DEFAULT '{}',
      source TEXT DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      item_id INTEGER,
      is_locked INTEGER DEFAULT 0,
      note TEXT,
      UNIQUE(category, slot_index)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS queue_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      thumbnail_url TEXT,
      external_id TEXT,
      metadata TEXT DEFAULT '{}',
      consumed INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ongoing_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      thumbnail_url TEXT,
      external_id TEXT,
      metadata TEXT DEFAULT '{}',
      airing_info TEXT,
      source TEXT DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS completion_stats (
      category TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0
    )
  `);

  try { await db.run('ALTER TABLE slots ADD COLUMN note TEXT') } catch {}
  try { await db.run('ALTER TABLE slots ADD COLUMN current_progress INTEGER DEFAULT 0') } catch {}
  try { await db.run('ALTER TABLE ongoing_items ADD COLUMN airing_info TEXT') } catch {}
  try { await db.run('ALTER TABLE completion_stats ADD COLUMN total_progress INTEGER DEFAULT 0') } catch {}
  try { await db.run('ALTER TABLE ongoing_items ADD COLUMN watched_progress INTEGER DEFAULT 0') } catch {}

  await migrateToMultiUser();

  // Must run after migrateToMultiUser() since sessions table is created there
  // Nullable column — libsql ALTER TABLE doesn't support NOT NULL + expression DEFAULT
  try { await db.run('ALTER TABLE sessions ADD COLUMN expires_at INTEGER') } catch {}
}

module.exports = { db, init, ensureUserSlots, cleanExpiredSessions };
