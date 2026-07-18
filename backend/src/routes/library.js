const express = require('express');
const router = express.Router();
const { db } = require('../database');

router.get('/:category', async (req, res) => {
  try {
    const items = await db.all('SELECT * FROM library_items WHERE category = ? ORDER BY title', [req.params.category]);
    res.json(items.map(i => ({ ...i, metadata: JSON.parse(i.metadata || '{}') })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:category', async (req, res) => {
  try {
    const { title, thumbnail_url, external_id, metadata } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
    const r = await db.run(
      'INSERT INTO library_items (category, title, thumbnail_url, external_id, metadata, source) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.category, title.trim(), thumbnail_url || null, external_id || null, JSON.stringify(metadata || {}), 'manual']
    );
    res.json({ id: r.lastInsertRowid, title: title.trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.run('UPDATE slots SET item_id = NULL, is_locked = 0 WHERE item_id = ?', [req.params.id]);
    await db.run('DELETE FROM library_items WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
