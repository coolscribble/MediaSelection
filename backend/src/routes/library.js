const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db } = require('../database');
const { COVERS_DIR, titleSlug } = require('../services/imageCache');

async function deleteLocalCover(url) {
  if (!url?.startsWith('/api/covers/')) return;
  const other = await db.get('SELECT id FROM library_items WHERE thumbnail_url = ?', [url]);
  if (other) return;
  const rel = url.slice('/api/covers/'.length);
  try { fs.unlinkSync(path.join(COVERS_DIR, rel)); } catch {}
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const VALID_CATEGORIES = new Set(['movies', 'series', 'anime', 'manga', 'games', 'comics', 'albums']);

function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  return null;
}

router.get('/:category', async (req, res) => {
  if (!VALID_CATEGORIES.has(req.params.category)) return res.status(400).json({ error: 'Invalid category' });
  try {
    const items = await db.all(
      'SELECT * FROM library_items WHERE user_id = ? AND category = ? ORDER BY title',
      [req.userId, req.params.category]
    );
    res.json(items.map(i => ({ ...i, metadata: JSON.parse(i.metadata || '{}') })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:category', async (req, res) => {
  if (!VALID_CATEGORIES.has(req.params.category)) return res.status(400).json({ error: 'Invalid category' });
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
  if (!VALID_CATEGORIES.has(req.params.category)) return res.status(400).json({ error: 'Invalid category' });
  try {
    const covers = await db.all(
      'SELECT thumbnail_url FROM library_items WHERE user_id = ? AND category = ? AND thumbnail_url LIKE ?',
      [req.userId, req.params.category, '/api/covers/%']
    );
    await db.run(
      `UPDATE slots SET item_id = NULL, is_locked = 0
       WHERE user_id = ? AND item_id IN (SELECT id FROM library_items WHERE user_id = ? AND category = ?)`,
      [req.userId, req.userId, req.params.category]
    );
    await db.run(
      'DELETE FROM library_items WHERE user_id = ? AND category = ?',
      [req.userId, req.params.category]
    );
    for (const { thumbnail_url } of covers) await deleteLocalCover(thumbnail_url);
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
    const ext = detectImageType(req.file.buffer);
    if (!ext) return res.status(400).json({ error: 'File must be a valid image (JPEG, PNG, WebP, or GIF)' });
    const filename = `${titleSlug(item.title)}.${ext}`;
    fs.writeFileSync(path.join(subdir, filename), req.file.buffer);
    const localUrl = `/api/covers/${item.category}/${filename}`;
    await db.run('UPDATE library_items SET thumbnail_url = ? WHERE id = ?', [localUrl, item.id]);
    res.json({ thumbnail_url: localUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const item = await db.get(
      'SELECT thumbnail_url FROM library_items WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    await db.run(
      'UPDATE slots SET item_id = NULL, is_locked = 0 WHERE user_id = ? AND item_id = ?',
      [req.userId, req.params.id]
    );
    await db.run(
      'DELETE FROM library_items WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (item?.thumbnail_url) await deleteLocalCover(item.thumbnail_url);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
