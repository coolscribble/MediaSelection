'use strict';
const express = require('express');
const router  = express.Router();
const { db }  = require('../database');
const { simklQS, simklHeaders } = require('../services/simkl');

const BASE      = 'https://api.simkl.com';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const CACHE_TTL = 10 * 60 * 1000;
const CONC      = 20; // parallel TMDB calls per batch

const memCache = new Map();

function addCountry(countries, code, title) {
  if (!code || code.length !== 2) return;
  const key = code.toUpperCase();
  if (!countries[key]) countries[key] = { count: 0, titles: [] };
  countries[key].count++;
  if (countries[key].titles.length < 5) countries[key].titles.push(title);
}

async function runBatch(items, fn) {
  for (let i = 0; i < items.length; i += CONC) {
    await Promise.allSettled(items.slice(i, i + CONC).map(fn));
  }
}

// ─── GET /api/worldmap ────────────────────────────────────────────────────────
// Without ?fresh=true  → fast path: aggregate from DB country_code cache
// With    ?fresh=true  → fetch from Simkl API, look up any uncached items in
//                        TMDB, store results in DB, return full result
router.get('/', async (req, res) => {
  try {
    const now     = Date.now();
    const fresh   = req.query.fresh === 'true' || req.query.fresh === '1';
    const recache = req.query.recache === 'true';

    // Wipe stored country codes so TMDB is re-queried (useful after code fixes)
    if (recache) {
      await db.run('UPDATE library_items SET country_code = NULL WHERE user_id = ?', [req.userId]);
      memCache.delete(req.userId);
    }

    // In-memory cache (always serve from here when warm, regardless of fresh)
    const mem = memCache.get(req.userId);
    if (!fresh && mem && now - mem.fetchedAt < CACHE_TTL) {
      return res.json(mem.data);
    }

    // ── Fast path (initial page load) ─────────────────────────────────────────
    if (!fresh) {
      const rows = await db.all(
        `SELECT title, category, country_code FROM library_items
         WHERE user_id = ? AND country_code IS NOT NULL`,
        [req.userId]
      );
      // Anime items without country_code are always JP
      const animeRows = await db.all(
        `SELECT title FROM library_items
         WHERE user_id = ? AND category = 'anime' AND country_code IS NULL`,
        [req.userId]
      );

      const countries = {};
      for (const row of rows)      addCountry(countries, row.country_code, row.title);
      for (const row of animeRows) addCountry(countries, 'JP',             row.title);

      const data = { countries };
      memCache.set(req.userId, { data, fetchedAt: now });
      return res.json(data);
    }

    // ── Fresh path (user clicked "Sync from Simkl") ───────────────────────────
    const [cidRow, tokenRow, tmdbRow] = await Promise.all([
      db.get("SELECT value FROM settings WHERE user_id = ? AND key = 'simkl_client_id'",    [req.userId]),
      db.get("SELECT value FROM settings WHERE user_id = ? AND key = 'simkl_access_token'", [req.userId]),
      db.get("SELECT value FROM settings WHERE user_id = ? AND key = 'tmdb_api_key'",        [req.userId]),
    ]);

    if (!cidRow?.value || !tokenRow?.value) {
      return res.status(400).json({ error: 'Simkl not configured. Connect Simkl in Settings first.' });
    }

    const cid     = cidRow.value;
    const token   = tokenRow.value;
    const tmdbKey = tmdbRow?.value || null;
    const headers = simklHeaders(token, cid);

    // Collect all completed/watching items from Simkl, deduplicated by simkl ID
    const simklItems = new Map(); // simklId → { simklId, title, category, tmdbId }

    const TYPES = [
      { type: 'movies', key: 'movie', category: 'movies' },
      { type: 'shows',  key: 'show',  category: 'series' },
      { type: 'anime',  key: 'anime', category: 'anime'  },
    ];

    for (const { type, key, category } of TYPES) {
      for (const status of ['completed', 'watching']) {
        const qs = simklQS(cid, { extended: 'full' });
        const r  = await fetch(`${BASE}/sync/all-items/${status}/${type}?${qs}`, { headers });
        if (r.status === 404) continue;
        if (!r.ok) { console.warn(`[worldmap] ${status}/${type}: ${r.status}`); continue; }
        const data = await r.json();

        for (const entry of (data[type] || [])) {
          const item = entry[key];
          if (!item?.ids?.simkl) continue;
          const simklId = String(item.ids.simkl);
          if (!simklItems.has(simklId)) {
            simklItems.set(simklId, {
              simklId,
              title:    item.title,
              category,
              tmdbId:   item.ids?.tmdb ? String(item.ids.tmdb) : null,
            });
          }
        }
      }
    }

    console.log(`[worldmap] Simkl: ${simklItems.size} unique items (anime/shows/movies)`);

    // Check DB for already-cached country codes
    const allIds   = [...simklItems.keys()];
    const dbCodes  = new Map(); // simklId → country_code
    const chunkSz  = 500;
    for (let i = 0; i < allIds.length; i += chunkSz) {
      const chunk = allIds.slice(i, i + chunkSz);
      const ph    = chunk.map(() => '?').join(',');
      const rows  = await db.all(
        `SELECT external_id, country_code FROM library_items
         WHERE user_id = ? AND external_id IN (${ph}) AND country_code IS NOT NULL`,
        [req.userId, ...chunk]
      );
      for (const row of rows) dbCodes.set(row.external_id, row.country_code);
    }

    const countries  = {};
    const toUpdateDb = []; // { simklId, code }
    const tmdbQueue  = []; // items needing TMDB lookup

    for (const [simklId, item] of simklItems) {
      if (item.category === 'anime') {
        if (!dbCodes.has(simklId)) toUpdateDb.push({ simklId, code: 'JP' });
        addCountry(countries, 'JP', item.title);
      } else if (dbCodes.has(simklId)) {
        addCountry(countries, dbCodes.get(simklId), item.title);
      } else if (tmdbKey && item.tmdbId) {
        tmdbQueue.push(item);
      }
    }

    // TMDB lookups for uncached shows/movies
    if (tmdbQueue.length > 0) {
      console.log(`[worldmap] TMDB lookups: ${tmdbQueue.length} uncached items`);
      await runBatch(tmdbQueue, async (item) => {
        try {
          const ep = item.category === 'series' ? 'tv' : 'movie';
          const r  = await fetch(`${TMDB_BASE}/${ep}/${item.tmdbId}?api_key=${tmdbKey}&language=en-US`);
          if (!r.ok) return;
          const d  = await r.json();
          // origin_country is the most reliable for both movies and TV
          // production_countries[0] is a fallback (may reflect co-production partner)
          const code = d.origin_country?.[0]
            || d.production_countries?.[0]?.iso_3166_1;
          if (code) {
            const uc = code.toUpperCase();
            toUpdateDb.push({ simklId: item.simklId, code: uc });
            addCountry(countries, uc, item.title);
          }
        } catch { /* ignore individual failures */ }
      });
    } else if (!tmdbKey && simklItems.size > 0) {
      const uncached = [...simklItems.values()].filter(i => i.category !== 'anime' && !dbCodes.has(i.simklId)).length;
      if (uncached > 0) console.log(`[worldmap] skipping ${uncached} movies/shows (no TMDB API key configured)`);
    }

    // Persist new country codes to DB in bulk
    if (toUpdateDb.length > 0) {
      console.log(`[worldmap] caching ${toUpdateDb.length} country codes to DB`);
      await db.batch(toUpdateDb.map(({ simklId, code }) => ({
        sql:  'UPDATE library_items SET country_code = ? WHERE user_id = ? AND external_id = ?',
        args: [code, req.userId, simklId],
      })));
    }

    const data = { countries };
    memCache.set(req.userId, { data, fetchedAt: now });
    res.json(data);
  } catch (e) {
    console.error('[worldmap]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
