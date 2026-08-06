'use strict';

const express = require('express');
const router = express.Router();
const { db } = require('../database');

// List all collections with item count + completion
router.get('/', async (req, res) => {
  try {
    const cols = await db.all(
      'SELECT id, name, category, cover_url, external_id, franchise_total, created_at FROM collections WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    );
    const result = await Promise.all(cols.map(async col => {
      const items = await db.all(
        'SELECT id, library_item_id, title, thumbnail_url, completed_at, sort_order, tmdb_id FROM collection_items WHERE collection_id = ? ORDER BY sort_order, added_at',
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
      'SELECT id, title, thumbnail_url, metadata FROM library_items WHERE id = ? AND user_id = ? AND category = ?',
      [library_item_id, req.userId, col.category]
    );
    if (!item) return res.status(404).json({ error: 'Library item not found or wrong category' });

    const dup = await db.get(
      'SELECT id FROM collection_items WHERE collection_id = ? AND library_item_id = ?',
      [col.id, library_item_id]
    );
    if (dup) return res.status(400).json({ error: 'Item already in collection' });

    const tmdbId = (() => { try { return JSON.parse(item.metadata || '{}').tmdb_id || null; } catch { return null; } })();
    const r = await db.run(
      'INSERT INTO collection_items (collection_id, library_item_id, title, thumbnail_url, tmdb_id) VALUES (?, ?, ?, ?, ?)',
      [col.id, library_item_id, item.title, item.thumbnail_url, tmdbId]
    );
    res.json({ id: r.lastInsertRowid, library_item_id: item.id, title: item.title, thumbnail_url: item.thumbnail_url, tmdb_id: tmdbId });
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

// Franchise movies not yet in this collection, with library status per entry
router.get('/:id/missing', async (req, res) => {
  try {
    const col = await db.get(
      'SELECT id, category, external_id FROM collections WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (!col) return res.status(404).json({ error: 'Not found' });
    if (col.category !== 'movies' || !col.external_id) return res.json({ missing: [] });

    const keyRow = await db.get(
      'SELECT value FROM settings WHERE user_id = ? AND key = ?',
      [req.userId, 'tmdb_api_key']
    );
    if (!keyRow?.value) return res.status(400).json({ error: 'TMDB API key not configured in Settings' });

    const r = await fetch(
      `https://api.themoviedb.org/3/collection/${encodeURIComponent(col.external_id)}?api_key=${encodeURIComponent(keyRow.value)}`
    );
    if (!r.ok) return res.status(502).json({ error: `TMDB error: ${r.status}` });
    const data = await r.json();

    // TMDB IDs already in THIS collection (current + completed items)
    const colItems = await db.all(
      'SELECT tmdb_id FROM collection_items WHERE collection_id = ? AND tmdb_id IS NOT NULL',
      [col.id]
    );
    const colTmdbIds = new Set(colItems.map(ci => ci.tmdb_id));

    // User's entire movies library keyed by tmdb_id → { finished }
    const userMovies = await db.all(
      "SELECT metadata FROM library_items WHERE user_id = ? AND category = 'movies'",
      [req.userId]
    );
    const userByTmdb = new Map(); // tmdb_id → { finished: bool }
    for (const m of userMovies) {
      try {
        const meta = JSON.parse(m.metadata || '{}');
        if (meta.tmdb_id) userByTmdb.set(meta.tmdb_id, { finished: meta.status === 'completed' });
      } catch { /* skip */ }
    }

    const parts = data.parts || [];
    const franchiseTotal = parts.length;

    // Cache the franchise total so cards can show correct denominator without extra calls
    await db.run('UPDATE collections SET franchise_total = ? WHERE id = ?', [franchiseTotal, col.id]);

    const missing = parts
      .filter(p => p.id && !colTmdbIds.has(p.id))
      .map(p => {
        const lib = userByTmdb.get(p.id);
        return {
          tmdb_id:      p.id,
          title:        p.title,
          release_date: p.release_date || null,
          poster_url:   p.poster_path ? `https://image.tmdb.org/t/p/w200${p.poster_path}` : null,
          in_library:   !!lib,
          finished:     lib?.finished ?? false,
        };
      })
      .sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''));

    res.json({ missing, franchise_total: franchiseTotal });
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
      // Fetch franchise details to get total parts count
      let franchiseTotal = null;
      try {
        const fr = await fetch(`https://api.themoviedb.org/3/collection/${colId}?api_key=${encodeURIComponent(apiKey)}`);
        if (fr.ok) franchiseTotal = ((await fr.json()).parts || []).length;
      } catch { /* non-fatal */ }

      const col = await db.run(
        'INSERT INTO collections (user_id, name, category, cover_url, external_id, franchise_total) VALUES (?, ?, ?, ?, ?, ?)',
        [req.userId, group.name, 'movies', group.poster, String(colId), franchiseTotal]
      );
      for (const movie of group.movies) {
        const tmdbId = (() => { try { return JSON.parse(movie.metadata || '{}').tmdb_id || null; } catch { return null; } })();
        await db.run(
          'INSERT INTO collection_items (collection_id, library_item_id, title, thumbnail_url, tmdb_id) VALUES (?, ?, ?, ?, ?)',
          [col.lastInsertRowid, movie.id, movie.title, movie.thumbnail_url, tmdbId]
        );
      }
      created++;
    }

    res.json({ created, checked: movies.length, groups: groups.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Auto-detect anime collections from AniList relations graph
router.post('/auto-detect-anime', async (req, res) => {
  try {
    const animeItems = await db.all(
      "SELECT id, title, external_id, thumbnail_url FROM library_items WHERE user_id = ? AND category = 'anime' AND external_id IS NOT NULL",
      [req.userId]
    );
    if (!animeItems.length) return res.json({ created: 0, checked: 0, message: 'No anime with AniList IDs' });

    // Map anilistId → library item (skip non-numeric ids)
    const idMap = new Map();
    for (const item of animeItems) {
      const n = parseInt(item.external_id, 10);
      if (!isNaN(n) && n > 0) idMap.set(n, item);
    }
    const ids = [...idMap.keys()];

    // Batch fetch AniList relations (10 per query to stay within complexity limits)
    const BATCH = 10;
    const adjacency = new Map(); // anilistId → Set<anilistId> (in library)

    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const query = `{\n${batch.map(id =>
        `a${id}: Media(id: ${id}, type: ANIME) { id relations { edges { relationType(version: 2) node { id type } } } }`
      ).join('\n')}\n}`;
      try {
        const resp = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query }),
        });
        const json = await resp.json();
        for (const id of batch) {
          const media = json?.data?.[`a${id}`];
          if (!media) continue;
          const related = new Set();
          for (const edge of (media.relations?.edges || [])) {
            if (!['SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY'].includes(edge.relationType)) continue;
            if (edge.node?.type !== 'ANIME') continue;
            if (idMap.has(edge.node.id)) related.add(edge.node.id);
          }
          if (related.size > 0) adjacency.set(id, related);
        }
      } catch { /* skip batch on network error */ }
      if (i + BATCH < ids.length) await new Promise(r => setTimeout(r, 800));
    }

    // BFS to find connected components
    const visited = new Set();
    const components = [];
    for (const id of ids) {
      if (visited.has(id)) continue;
      const component = [];
      const queue = [id];
      while (queue.length) {
        const curr = queue.shift();
        if (visited.has(curr)) continue;
        visited.add(curr);
        component.push(curr);
        for (const neighbor of (adjacency.get(curr) || [])) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
      if (component.length >= 2) components.push(component);
    }

    let created = 0;
    for (const component of components) {
      const items = component.map(id => idMap.get(id)).filter(Boolean);
      // Skip if any item in this group is already in an anime collection
      const placeholders = items.map(() => '?').join(',');
      const alreadyIn = await db.get(
        `SELECT ci.id FROM collection_items ci JOIN collections c ON c.id = ci.collection_id WHERE c.user_id = ? AND c.category = 'anime' AND ci.library_item_id IN (${placeholders}) LIMIT 1`,
        [req.userId, ...items.map(i => i.id)]
      );
      if (alreadyIn) continue;

      // Use the item with the lowest AniList ID as the root (oldest/original)
      const root = items.reduce((a, b) => (Number(a.external_id) < Number(b.external_id) ? a : b));
      // Strip trailing season/part suffixes for the collection name
      const name = root.title.replace(/\s+(Season\s+\d+|Part\s+\d+|\d+(st|nd|rd|th)\s+Season)\s*.*$/i, '').trim() || root.title;

      const col = await db.run(
        "INSERT INTO collections (user_id, name, category, cover_url) VALUES (?, ?, 'anime', ?)",
        [req.userId, name, root.thumbnail_url]
      );
      for (const item of items) {
        await db.run(
          'INSERT INTO collection_items (collection_id, library_item_id, title, thumbnail_url) VALUES (?, ?, ?, ?)',
          [col.lastInsertRowid, item.id, item.title, item.thumbnail_url]
        );
      }
      created++;
    }

    res.json({ created, checked: ids.length, components: components.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Shared helpers ────────────────────────────────────────────────────────────

function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  return (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

// After upsert: match watched_items against collection_items and update completed_at.
// Returns { updated }.
async function applyWatchedToCollections(userId) {
  // Gather all watched item identifiers for this user
  const watched = await db.all(
    'SELECT source, category, external_id, tmdb_id FROM watched_items WHERE user_id = ?',
    [userId]
  );
  const watchedTmdb    = new Set();  // Number tmdb_ids
  const watchedSrcKey  = new Set();  // `${source}:${category}:${external_id}`
  for (const w of watched) {
    if (w.tmdb_id)     watchedTmdb.add(Number(w.tmdb_id));
    if (w.external_id) watchedSrcKey.add(`${w.source}:${w.category}:${w.external_id}`);
  }

  // All non-completed collection items for this user, with their library link
  const colItems = await db.all(`
    SELECT ci.id, ci.tmdb_id, ci.library_item_id,
           li.external_id AS lib_ext_id,
           li.category    AS lib_cat,
           li.source      AS lib_source
    FROM collection_items ci
    JOIN collections c ON c.id = ci.collection_id
    LEFT JOIN library_items li ON li.id = ci.library_item_id
    WHERE c.user_id = ? AND ci.completed_at IS NULL
  `, [userId]);

  const toUpdate = new Set();
  for (const ci of colItems) {
    // 1. Match by TMDB ID on the collection item (most reliable — movies always have this)
    if (ci.tmdb_id && watchedTmdb.has(Number(ci.tmdb_id))) {
      toUpdate.add(ci.id);
      continue;
    }
    // 2. Match by source:category:external_id via the library item link
    //    (series/anime that are still in the library)
    if (ci.lib_ext_id && ci.lib_cat && ci.lib_source) {
      if (watchedSrcKey.has(`${ci.lib_source}:${ci.lib_cat}:${ci.lib_ext_id}`)) {
        toUpdate.add(ci.id);
      }
    }
  }

  let updated = 0;
  for (const id of toUpdate) {
    await db.run('UPDATE collection_items SET completed_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    updated++;
  }
  return { updated };
}

// ── Sync from Simkl ───────────────────────────────────────────────────────────

router.get('/sync-watched/simkl', async (req, res) => {
  const send = sseSetup(res);
  try {
    const [cidRow, tokenRow] = await Promise.all([
      db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [req.userId, 'simkl_client_id']),
      db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [req.userId, 'simkl_access_token']),
    ]);
    if (!cidRow?.value || !tokenRow?.value) {
      send({ step: 'Simkl is not configured. Add your Client ID and token in Settings → Connections.', pct: 100, done: true, error: true });
      return res.end();
    }

    const cid   = cidRow.value;
    const token = tokenRow.value;
    const hdrs  = {
      Authorization: `Bearer ${token}`,
      'simkl-api-key': cid,
      'Content-Type': 'application/json',
    };

    const types = [
      { type: 'movies', key: 'movie', cat: 'movies', label: 'movies'   },
      { type: 'shows',  key: 'show',  cat: 'series', label: 'TV shows' },
      { type: 'anime',  key: 'anime', cat: 'anime',  label: 'anime'    },
    ];

    let totalFetched = 0;

    for (let i = 0; i < types.length; i++) {
      const { type, key, cat, label } = types[i];
      send({ step: `Fetching completed ${label} from Simkl…`, pct: 5 + i * 20 });

      let items;
      try {
        const r = await fetch(
          `https://api.simkl.com/sync/all-items/completed/${type}?client_id=${encodeURIComponent(cid)}&extended=full`,
          { headers: hdrs }
        );
        if (!r.ok) {
          send({ step: `Simkl ${label}: server returned ${r.status}`, pct: 10 + i * 20 });
          continue;
        }
        items = (await r.json())[type] || [];
      } catch (e) {
        send({ step: `Simkl ${label}: network error — ${e.message}`, pct: 10 + i * 20 });
        continue;
      }

      send({ step: `Saving ${items.length} completed ${label} to database…`, pct: 12 + i * 20 });
      for (const entry of items) {
        const item = entry[key];
        if (!item) continue;
        const simklId = item.ids?.simkl ? String(item.ids.simkl) : null;
        if (!simklId) continue;
        const tmdbId = item.ids?.tmdb ? Number(item.ids.tmdb) : null;
        await db.run(
          `INSERT INTO watched_items (user_id, source, category, title, external_id, tmdb_id, synced_at)
           VALUES (?, 'simkl', ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, source, category, external_id)
           DO UPDATE SET title = excluded.title, tmdb_id = excluded.tmdb_id, synced_at = CURRENT_TIMESTAMP`,
          [req.userId, cat, item.title || null, simklId, tmdbId]
        );
        totalFetched++;
      }
    }

    send({ step: `${totalFetched} watched items saved. Updating collection entries…`, pct: 75 });
    const { updated } = await applyWatchedToCollections(req.userId);

    send({
      step: updated === 0
        ? `${totalFetched} items saved. No new collection entries to mark.`
        : `${totalFetched} items saved. ${updated} collection entr${updated === 1 ? 'y' : 'ies'} marked as watched!`,
      pct: 100, done: true, result: { fetched: totalFetched, updated },
    });
    res.end();
  } catch (e) {
    send({ step: `Error: ${e.message}`, pct: 100, done: true, error: true });
    res.end();
  }
});

// ── Sync from AniList ─────────────────────────────────────────────────────────

router.get('/sync-watched/anilist', async (req, res) => {
  const send = sseSetup(res);
  try {
    const userRow = await db.get(
      'SELECT value FROM settings WHERE user_id = ? AND key = ?',
      [req.userId, 'anilist_username']
    );
    if (!userRow?.value) {
      send({ step: 'AniList username is not configured. Add it in Settings → Connections.', pct: 100, done: true, error: true });
      return res.end();
    }

    const username = userRow.value;
    const alFetch  = async (type) => {
      const query = `query($u:String,$t:MediaType){MediaListCollection(userName:$u,type:$t,status:COMPLETED){lists{entries{media{id title{romaji english}}}}}}`;
      const r = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables: { u: username, t: type } }),
      });
      if (!r.ok) throw new Error(`AniList API returned ${r.status}`);
      const json = await r.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return (json.data?.MediaListCollection?.lists || []).flatMap(l => l.entries);
    };

    let totalFetched = 0;

    for (const [type, cat, label] of [['ANIME', 'anime', 'anime'], ['MANGA', 'manga', 'manga']]) {
      send({ step: `Fetching completed ${label} from AniList…`, pct: type === 'ANIME' ? 10 : 50 });
      let entries;
      try {
        entries = await alFetch(type);
      } catch (e) {
        send({ step: `AniList ${label}: ${e.message}`, pct: type === 'ANIME' ? 20 : 60 });
        continue;
      }

      send({ step: `Saving ${entries.length} completed ${label} to database…`, pct: type === 'ANIME' ? 25 : 60 });
      for (const entry of entries) {
        const media = entry.media;
        if (!media?.id) continue;
        const title = media.title?.english || media.title?.romaji || null;
        await db.run(
          `INSERT INTO watched_items (user_id, source, category, title, external_id, synced_at)
           VALUES (?, 'anilist', ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, source, category, external_id)
           DO UPDATE SET title = excluded.title, synced_at = CURRENT_TIMESTAMP`,
          [req.userId, cat, title, String(media.id)]
        );
        totalFetched++;
      }
    }

    send({ step: `${totalFetched} watched items saved. Updating collection entries…`, pct: 80 });
    const { updated } = await applyWatchedToCollections(req.userId);

    send({
      step: updated === 0
        ? `${totalFetched} items saved. No new collection entries to mark.`
        : `${totalFetched} items saved. ${updated} collection entr${updated === 1 ? 'y' : 'ies'} marked as watched!`,
      pct: 100, done: true, result: { fetched: totalFetched, updated },
    });
    res.end();
  } catch (e) {
    send({ step: `Error: ${e.message}`, pct: 100, done: true, error: true });
    res.end();
  }
});

module.exports = router;
