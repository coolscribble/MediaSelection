const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db } = require('../database');
const { COVERS_DIR, titleSlug } = require('../services/imageCache');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/:category', async (req, res) => {
  try {
    const items = await db.all(
      'SELECT * FROM library_items WHERE user_id = ? AND category = ? ORDER BY title',
      [req.userId, req.params.category]
    );
    res.json(items.map(i => ({ ...i, metadata: JSON.parse(i.metadata || '{}') })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:category', async (req, res) => {
  try {
    const { title, thumbnail_url, external_id, metadata } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
    const r = await db.run(
      'INSERT INTO library_items (user_id, category, title, thumbnail_url, external_id, metadata, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.userId, req.params.category, title.trim(), thumbnail_url || null, external_id || null, JSON.stringify(metadata || {}), 'manual']
    );
    res.json({ id: r.lastInsertRowid, title: title.trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/clear/:category', async (req, res) => {
  try {
    await db.run(
      `UPDATE slots SET item_id = NULL, is_locked = 0
       WHERE user_id = ? AND item_id IN (SELECT id FROM library_items WHERE user_id = ? AND category = ?)`,
      [req.userId, req.userId, req.params.category]
    );
    await db.run(
      'DELETE FROM library_items WHERE user_id = ? AND category = ?',
      [req.userId, req.params.category]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const item = await db.get(
      'SELECT metadata FROM library_items WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (!item) return res.status(404).json({ error: 'Not found' });
    const { thumbnail_url, clear_review } = req.body;
    const sets = [], vals = [];
    if (thumbnail_url !== undefined) { sets.push('thumbnail_url = ?'); vals.push(thumbnail_url || null); }
    if (clear_review) {
      const meta = JSON.parse(item.metadata || '{}');
      delete meta.cv_needs_review;
      delete meta.cv_candidates;
      sets.push('metadata = ?');
      vals.push(JSON.stringify(meta));
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await db.run(`UPDATE library_items SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/cover', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const item = await db.get(
      'SELECT id, category, title FROM library_items WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const subdir = path.join(COVERS_DIR, item.category);
    if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });
    const mime = req.file.mimetype || '';
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
    const filename = `${titleSlug(item.title)}.${ext}`;
    fs.writeFileSync(path.join(subdir, filename), req.file.buffer);
    const localUrl = `/api/covers/${item.category}/${filename}`;
    await db.run('UPDATE library_items SET thumbnail_url = ? WHERE id = ?', [localUrl, item.id]);
    res.json({ thumbnail_url: localUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.run(
      'UPDATE slots SET item_id = NULL, is_locked = 0 WHERE user_id = ? AND item_id = ?',
      [req.userId, req.params.id]
    );
    await db.run(
      'DELETE FROM library_items WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
