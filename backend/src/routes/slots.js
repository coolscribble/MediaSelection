const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { db } = require('../database');
const { COVERS_DIR } = require('../services/imageCache');

async function deleteLocalCover(url) {
  if (!url?.startsWith('/api/covers/')) return;
  const other = await db.get('SELECT id FROM library_items WHERE thumbnail_url = ?', [url]);
  if (other) return;
  const rel = url.slice('/api/covers/'.length);
  try { fs.unlinkSync(path.join(COVERS_DIR, rel)); } catch {}
}

const CATEGORIES = ['movies', 'series', 'anime', 'manga', 'games', 'comics', 'albums'];

async function isQueueMode(userId, category) {
  const row = await db.get(
    'SELECT value FROM settings WHERE user_id = ? AND key = ?',
    [userId, `queue_mode_${category}`]
  );
  return row?.value === 'true';
}

async function consumeNextQueueItem(userId, category) {
  const item = await db.get(
    'SELECT * FROM queue_items WHERE user_id = ? AND category = ? AND consumed = 0 ORDER BY position ASC LIMIT 1',
    [userId, category]
  );
  if (!item) return null;
  await db.run('UPDATE queue_items SET consumed = 1 WHERE id = ?', [item.id]);

  if (item.external_id) {
    const existing = await db.get(
      'SELECT id FROM library_items WHERE user_id = ? AND category = ? AND external_id = ?',
      [userId, category, item.external_id]
    );
    if (existing) return { libId: existing.id, title: item.title };
  }
  const r = await db.run(
    'INSERT INTO library_items (user_id, category, title, external_id, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, category, item.title, item.external_id, item.thumbnail_url, item.metadata || '{}', 'queue']
  );
  return { libId: r.lastInsertRowid, title: item.title };
}

async function incrementStat(userId, category, progress) {
  await db.run(
    `INSERT INTO completion_stats (user_id, category, count, total_progress) VALUES (?, ?, 1, ?)
     ON CONFLICT(user_id, category) DO UPDATE SET count = count + 1, total_progress = total_progress + ?`,
    [userId, category, progress || 0, progress || 0]
  );
}

router.get('/', async (req, res) => {
  try {
    const slots = await db.all(`
      SELECT s.id, s.category, s.slot_index, s.item_id, s.is_locked, s.note, s.current_progress,
             li.title, li.thumbnail_url, li.external_id, li.metadata, li.source
      FROM slots s
      LEFT JOIN library_items li ON s.item_id = li.id
      WHERE s.user_id = ?
      ORDER BY s.category, s.slot_index
    `, [req.userId]);
    const result = {};
    for (const cat of CATEGORIES) {
      result[cat] = slots
        .filter(s => s.category === cat)
        .map(s => ({
          ...s,
          is_locked: Boolean(s.is_locked),
          current_progress: s.current_progress || 0,
          metadata: s.metadata ? JSON.parse(s.metadata) : {},
        }));
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/lock', async (req, res) => {
  try {
    const slot = await db.get('SELECT * FROM slots WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    await db.run('UPDATE slots SET is_locked = ? WHERE id = ?', [slot.is_locked ? 0 : 1, req.params.id]);
    res.json({ is_locked: !slot.is_locked });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const slot = await db.get('SELECT * FROM slots WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });

    const completedItemId = slot.item_id;
    if (completedItemId) await incrementStat(req.userId, slot.category, slot.current_progress || 0);

    const completedItem = completedItemId
      ? await db.get('SELECT thumbnail_url FROM library_items WHERE id = ?', [completedItemId])
      : null;

    await db.run(
      'UPDATE slots SET item_id = NULL, is_locked = 0, note = NULL, current_progress = 0 WHERE id = ?',
      [req.params.id]
    );

    if (completedItemId) {
      await db.run('DELETE FROM library_items WHERE id = ?', [completedItemId]);
      if (completedItem?.thumbnail_url) await deleteLocalCover(completedItem.thumbnail_url);
    }

    if (await isQueueMode(req.userId, slot.category)) {
      const next = await consumeNextQueueItem(req.userId, slot.category);
      if (next) {
        await db.run('UPDATE slots SET item_id = ? WHERE id = ?', [next.libId, req.params.id]);
        return res.json({ success: true, auto_filled: next.title });
      }
      return res.json({ success: true, auto_filled: null, message: 'Queue is empty' });
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/note', async (req, res) => {
  try {
    const { note } = req.body;
    await db.run('UPDATE slots SET note = ? WHERE id = ? AND user_id = ?', [note || null, req.params.id, req.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/progress', async (req, res) => {
  try {
    const { progress } = req.body;
    if (typeof progress !== 'number' || progress < 0) return res.status(400).json({ error: 'Invalid progress value' });
    await db.run(
      'UPDATE slots SET current_progress = ? WHERE id = ? AND user_id = ?',
      [Math.floor(progress), req.params.id, req.userId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/reroll', async (req, res) => {
  try {
    const slot = await db.get('SELECT * FROM slots WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    if (slot.is_locked) return res.status(400).json({ error: 'Slot is locked' });

    if (await isQueueMode(req.userId, slot.category)) {
      const next = await consumeNextQueueItem(req.userId, slot.category);
      if (!next) return res.status(400).json({ error: 'Queue is empty' });
      await db.run('UPDATE slots SET item_id = ?, current_progress = 0 WHERE id = ?', [next.libId, req.params.id]);
      const item = await db.get('SELECT * FROM library_items WHERE id = ?', [next.libId]);
      return res.json({ ...item, metadata: JSON.parse(item.metadata || '{}') });
    }

    const occupied = await db.all(
      'SELECT item_id FROM slots WHERE user_id = ? AND category = ? AND item_id IS NOT NULL AND id != ?',
      [req.userId, slot.category, req.params.id]
    );
    const excludeIds = occupied.map(r => r.item_id).filter(Boolean);
    let items;
    if (excludeIds.length) {
      items = await db.all(
        `SELECT * FROM library_items WHERE user_id = ? AND category = ? AND id NOT IN (${excludeIds.map(() => '?').join(',')})`,
        [req.userId, slot.category, ...excludeIds]
      );
    } else {
      items = await db.all(
        'SELECT * FROM library_items WHERE user_id = ? AND category = ?',
        [req.userId, slot.category]
      );
    }
    if (!items.length) return res.status(400).json({ error: 'No items in library for this category' });

    const picked = items[Math.floor(Math.random() * items.length)];
    await db.run('UPDATE slots SET item_id = ?, current_progress = 0 WHERE id = ?', [picked.id, req.params.id]);
    res.json({ ...picked, metadata: JSON.parse(picked.metadata || '{}') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/assign', async (req, res) => {
  try {
    const { item_id } = req.body;
    const slot = await db.get('SELECT * FROM slots WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    if (slot.is_locked) return res.status(400).json({ error: 'Slot is locked' });
    const item = await db.get(
      'SELECT * FROM library_items WHERE id = ? AND user_id = ? AND category = ?',
      [item_id, req.userId, slot.category]
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });
    await db.run('UPDATE slots SET item_id = ?, current_progress = 0 WHERE id = ?', [item_id, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/category/:category/reroll-all', async (req, res) => {
  try {
    const { category } = req.params;
    const unlockedSlots = await db.all(
      'SELECT * FROM slots WHERE user_id = ? AND category = ? AND is_locked = 0',
      [req.userId, category]
    );
    if (!unlockedSlots.length) return res.json({ success: true, message: 'All slots are locked' });

    if (await isQueueMode(req.userId, category)) {
      for (const slot of unlockedSlots) {
        const next = await consumeNextQueueItem(req.userId, category);
        if (!next) break;
        await db.run('UPDATE slots SET item_id = ?, current_progress = 0 WHERE id = ?', [next.libId, slot.id]);
      }
      return res.json({ success: true });
    }

    const locked = await db.all(
      'SELECT item_id FROM slots WHERE user_id = ? AND category = ? AND is_locked = 1 AND item_id IS NOT NULL',
      [req.userId, category]
    );
    const lockedIds = locked.map(r => r.item_id).filter(Boolean);
    let pool;
    if (lockedIds.length) {
      pool = await db.all(
        `SELECT * FROM library_items WHERE user_id = ? AND category = ? AND id NOT IN (${lockedIds.map(() => '?').join(',')})`,
        [req.userId, category, ...lockedIds]
      );
    } else {
      pool = await db.all(
        'SELECT * FROM library_items WHERE user_id = ? AND category = ?',
        [req.userId, category]
      );
    }
    if (pool.length < unlockedSlots.length) {
      return res.status(400).json({ error: `Not enough items: have ${pool.length}, need ${unlockedSlots.length}` });
    }
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    for (let i = 0; i < unlockedSlots.length; i++) {
      await db.run(
        'UPDATE slots SET item_id = ?, current_progress = 0 WHERE id = ?',
        [shuffled[i].id, unlockedSlots[i].id]
      );
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
