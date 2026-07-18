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

async function init() {
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

  // Migrations
  try { await db.run('ALTER TABLE slots ADD COLUMN note TEXT') } catch {}
  try { await db.run('ALTER TABLE slots ADD COLUMN current_progress INTEGER DEFAULT 0') } catch {}
  try { await db.run('ALTER TABLE ongoing_items ADD COLUMN airing_info TEXT') } catch {}
  try { await db.run('ALTER TABLE completion_stats ADD COLUMN total_progress INTEGER DEFAULT 0') } catch {}

  const CATS = ['movies', 'series', 'anime', 'manga', 'games', 'comics'];
  for (const cat of CATS) {
    for (let i = 1; i <= 3; i++) {
      await db.run('INSERT OR IGNORE INTO slots (category, slot_index) VALUES (?, ?)', [cat, i]);
    }
  }
}

module.exports = { db, init };
