'use strict';

const express = require('express');
const router = express.Router();
const { db } = require('../database');

// List all collections with item count + completion
router.get('/', async (req, res) => {
  try {
    const cols = await db.all(
      'SELECT id, name, category, cover_url, external_id, created_at FROM collections WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    );
    const result = await Promise.all(cols.map(async col => {
      const items = await db.all(
        'SELECT id, library_item_id, title, thumbnail_url, completed_at, sort_order FROM collection_items WHERE collection_id = ? ORDER BY sort_order, added_at',
        [col.id]
      );
      return { ...col, items };
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create collection
router.post('/', async (req, res) => {
  try {
    const { name, category } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!category) return res.status(400).json({ error: 'Category is required' });
    const r = await db.run(
      'INSERT INTO collections (user_id, name, category) VALUES (?, ?, ?)',
      [req.userId, name.trim(), category]
    );
    res.json({ id: r.lastInsertRowid, name: name.trim(), category, items: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update collection name/cover
router.patch('/:id', async (req, res) => {
  try {
    const col = await db.get('SELECT id FROM collections WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!col) return res.status(404).json({ error: 'Not found' });
    const { name, cover_url } = req.body || {};
    if (name) await db.run('UPDATE collections SET name = ? WHERE id = ?', [name.trim(), col.id]);
    if (cover_url !== undefined) await db.run('UPDATE collections SET cover_url = ? WHERE id = ?', [cover_url || null, col.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete collection
router.delete('/:id', async (req, res) => {
  try {
    const col = await db.get('SELECT id FROM collections WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!col) return res.status(404).json({ error: 'Not found' });
    await db.run('DELETE FROM collection_items WHERE collection_id = ?', [col.id]);
    await db.run('DELETE FROM collections WHERE id = ?', [col.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add item to collection
router.post('/:id/items', async (req, res) => {
  try {
    const col = await db.get('SELECT id, category FROM collections WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!col) return res.status(404).json({ error: 'Collection not found' });

    const { library_item_id } = req.body || {};
    if (!library_item_id) return res.status(400).json({ error: 'library_item_id is required' });

    const item = await db.get(
      'SELECT id, title, thumbnail_url FROM library_items WHERE id = ? AND user_id = ? AND category = ?',
      [library_item_id, req.userId, col.category]
    );
    if (!item) return res.status(404).json({ error: 'Library item not found or wrong category' });

    const dup = await db.get(
      'SELECT id FROM collection_items WHERE collection_id = ? AND library_item_id = ?',
      [col.id, library_item_id]
    );
    if (dup) return res.status(400).json({ error: 'Item already in collection' });

    const r = await db.run(
      'INSERT INTO collection_items (collection_id, library_item_id, title, thumbnail_url) VALUES (?, ?, ?, ?)',
      [col.id, library_item_id, item.title, item.thumbnail_url]
    );
    res.json({ id: r.lastInsertRowid, library_item_id: item.id, title: item.title, thumbnail_url: item.thumbnail_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove item from collection
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const col = await db.get('SELECT id FROM collections WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!col) return res.status(404).json({ error: 'Not found' });
    await db.run('DELETE FROM collection_items WHERE id = ? AND collection_id = ?', [req.params.itemId, col.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Auto-detect movie collections from TMDB
router.post('/auto-detect', async (req, res) => {
  try {
    const keyRow = await db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [req.userId, 'tmdb_api_key']);
    if (!keyRow?.value) return res.status(400).json({ error: 'TMDB API key not configured in Settings' });
    const apiKey = keyRow.value;

    const movies = await db.all(
      "SELECT id, title, thumbnail_url, metadata FROM library_items WHERE user_id = ? AND category = 'movies'",
      [req.userId]
    );

    const groups = new Map(); // tmdb_collection_id → { name, poster, movies[] }
    let apiCalls = 0;

    for (const movie of movies) {
      const meta = JSON.parse(movie.metadata || '{}');
      const tmdbId = meta.tmdb_id;
      if (!tmdbId) continue;
      if (apiCalls > 0) await new Promise(r => setTimeout(r, 300));
      apiCalls++;
      try {
        const r = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${encodeURIComponent(apiKey)}`);
        if (!r.ok) continue;
        const data = await r.json();
        const col = data.belongs_to_collection;
        if (!col) continue;
        if (!groups.has(col.id)) {
          groups.set(col.id, {
            name: col.name,
            poster: col.poster_path ? `https://image.tmdb.org/t/p/w300${col.poster_path}` : null,
            movies: [],
          });
        }
        groups.get(col.id).movies.push(movie);
      } catch { continue; }
    }

    let created = 0;
    for (const [colId, group] of groups) {
      if (group.movies.length < 2) continue;
      const existing = await db.get(
        'SELECT id FROM collections WHERE user_id = ? AND external_id = ?',
        [req.userId, String(colId)]
      );
      if (existing) continue;
      const col = await db.run(
        'INSERT INTO collections (user_id, name, category, cover_url, external_id) VALUES (?, ?, ?, ?, ?)',
        [req.userId, group.name, 'movies', group.poster, String(colId)]
      );
      for (const movie of group.movies) {
        await db.run(
          'INSERT INTO collection_items (collection_id, library_item_id, title, thumbnail_url) VALUES (?, ?, ?, ?)',
          [col.lastInsertRowid, movie.id, movie.title, movie.thumbnail_url]
        );
      }
      created++;
    }

    res.json({ created, checked: movies.length, groups: groups.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
