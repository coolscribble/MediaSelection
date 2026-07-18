const express = require('express');
const router = express.Router();
const multer = require('multer');
const { db } = require('../database');
const { importQueueCSV } = require('../services/csv');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/:category', async (req, res) => {
  try {
    const items = await db.all(
      'SELECT * FROM queue_items WHERE category = ? ORDER BY position ASC',
      [req.params.category]
    );
    res.json(items.map(i => ({ ...i, consumed: Boolean(i.consumed), metadata: JSON.parse(i.metadata || '{}') })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:category/item', async (req, res) => {
  try {
    const { title, thumbnail_url } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
    const maxRow = await db.get('SELECT MAX(position) as m FROM queue_items WHERE category = ?', [req.params.category]);
    const pos = (maxRow?.m ?? -1) + 1;
    const r = await db.run(
      'INSERT INTO queue_items (category, position, title, thumbnail_url, metadata) VALUES (?, ?, ?, ?, ?)',
      [req.params.category, pos, title.trim(), thumbnail_url || null, '{}']
    );
    res.json({ id: r.lastInsertRowid, position: pos, title: title.trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:category', async (req, res) => {
  try {
    await db.run('DELETE FROM queue_items WHERE category = ?', [req.params.category]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:category/item/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM queue_items WHERE id = ? AND category = ?', [req.params.id, req.params.category]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:category/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const count = await importQueueCSV(req.file.buffer, req.params.category);
    res.json({ imported: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
