'use strict';
const express = require('express');
const router  = express.Router();
const { db }  = require('../database');
const { simklQS, simklHeaders } = require('../services/simkl');
const { getWatchedItems }       = require('../services/jellyfin');

const BASE      = 'https://api.simkl.com';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const CACHE_TTL = 10 * 60 * 1000;
const CONC      = 20;

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

/** Read tmdb_country_cache rows for a list of {tmdbId, tmdbType} pairs. */
async function tmdbCacheGet(pairs) {
  if (!pairs.length) return new Map();
  const result = new Map(); // `${tmdbId}:${tmdbType}` → code
  const CHUNK  = 200;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    const ph    = chunk.map(() => '(?,?)').join(',');
    const args  = chunk.flatMap(p => [p.tmdbId, p.tmdbType]);
    const rows  = await db.all(
      `SELECT tmdb_id, tmdb_type, country_code FROM tmdb_country_cache
       WHERE (tmdb_id, tmdb_type) IN (${ph})`,
      args
    );
    for (const r of rows) result.set(`${r.tmdb_id}:${r.tmdb_type}`, r.country_code);
  }
  return result;
}

/** Look up country for a list of items via TMDB; store results in cache. */
async function lookupTmdb(items, tmdbKey, tmdbCached) {
  const toFetch  = items.filter(i => i.tmdbId && !tmdbCached.has(`${i.tmdbId}:${i.tmdbType}`));
  const newCodes = []; // { tmdbId, tmdbType, code }

  if (toFetch.length > 0) {
    console.log(`[worldmap] TMDB lookup: ${toFetch.length} uncached items`);
    await runBatch(toFetch, async (item) => {
      try {
        const r = await fetch(`${TMDB_BASE}/${item.tmdbType}/${item.tmdbId}?api_key=${tmdbKey}&language=en-US`);
        if (!r.ok) return;
        const d = await r.json();
        const code = d.origin_country?.[0]
          || d.production_countries?.[0]?.iso_3166_1;
        if (code) {
          const uc = code.toUpperCase();
          tmdbCached.set(`${item.tmdbId}:${item.tmdbType}`, uc);
          newCodes.push({ tmdbId: item.tmdbId, tmdbType: item.tmdbType, code: uc });
        }
      } catch { /* ignore */ }
    });

    if (newCodes.length > 0) {
      await db.batch(newCodes.map(({ tmdbId, tmdbType, code }) => ({
        sql:  'INSERT OR REPLACE INTO tmdb_country_cache (tmdb_id, tmdb_type, country_code) VALUES (?, ?, ?)',
        args: [tmdbId, tmdbType, code],
      })));
    }
  }

  // Aggregate results
  const countries = {};
  for (const item of items) {
    if (item.country) {
      addCountry(countries, item.country, item.title); // pre-resolved (anime = JP)
    } else {
      const code = tmdbCached.get(`${item.tmdbId}:${item.tmdbType}`);
      if (code) addCountry(countries, code, item.title);
    }
  }
  return countries;
}

// ─── GET /api/worldmap ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const now     = Date.now();
    const fresh   = req.query.fresh   === 'true' || req.query.fresh   === '1';
    const doJF    = req.query.jellyfin === 'true' || req.query.jellyfin === '1';
    const recache = req.query.recache === 'true';

    if (recache) {
      await db.run('UPDATE library_items SET country_code = NULL WHERE user_id = ?', [req.userId]);
      await db.run('DELETE FROM tmdb_country_cache');
      memCache.delete(req.userId);
    }

    // ── In-memory cache ────────────────────────────────────────────────────
    const mem = memCache.get(req.userId);
    if (!fresh && !doJF && mem && now - mem.fetchedAt < CACHE_TTL) {
      return res.json(mem.data);
    }

    // ── Fast path (initial page load, no fresh flag) ───────────────────────
    if (!fresh && !doJF) {
      const rows = await db.all(
        'SELECT title, category, country_code FROM library_items WHERE user_id = ? AND country_code IS NOT NULL',
        [req.userId]
      );
      const animeRows = await db.all(
        "SELECT title FROM library_items WHERE user_id = ? AND category = 'anime' AND country_code IS NULL",
        [req.userId]
      );
      // Include Jellyfin-only entries from tmdb_country_cache (title stored as tmdb_id there,
      // but we only expose aggregated counts — just sum the cache)
      const jfRows = await db.all(
        'SELECT country_code FROM jf_watched_cache WHERE user_id = ?',
        [req.userId]
      ).catch(() => []); // table may not exist yet

      const countries = {};
      for (const r of rows)      addCountry(countries, r.country_code, r.title);
      for (const r of animeRows) addCountry(countries, 'JP',           r.title);
      for (const r of jfRows)    if (r.country_code) {
        const key = r.country_code;
        if (!countries[key]) countries[key] = { count: 0, titles: [] };
        countries[key].count++;
      }

      const data = { countries };
      memCache.set(req.userId, { data, fetchedAt: now });
      return res.json(data);
    }

    // ── Fresh sync paths ───────────────────────────────────────────────────
    const [tmdbRow] = await Promise.all([
      db.get("SELECT value FROM settings WHERE user_id = ? AND key = 'tmdb_api_key'", [req.userId]),
    ]);
    const tmdbKey = tmdbRow?.value || null;

    let countries = {};

    // ── Simkl sync ────────────────────────────────────────────────────────
    if (fresh) {
      const [cidRow, tokenRow] = await Promise.all([
        db.get("SELECT value FROM settings WHERE user_id = ? AND key = 'simkl_client_id'",    [req.userId]),
        db.get("SELECT value FROM settings WHERE user_id = ? AND key = 'simkl_access_token'", [req.userId]),
      ]);

      if (!cidRow?.value || !tokenRow?.value) {
        return res.status(400).json({ error: 'Simkl not configured. Connect Simkl in Settings first.' });
      }

      const cid     = cidRow.value;
      const token   = tokenRow.value;
      const headers = simklHeaders(token, cid);
      const simklItems = new Map();

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
          if (!r.ok) { console.warn(`[worldmap/simkl] ${status}/${type}: ${r.status}`); continue; }
          const data = await r.json();

          for (const entry of (data[type] || [])) {
            const item = entry[key];
            if (!item?.ids?.simkl) continue;
            const simklId = String(item.ids.simkl);
            if (!simklItems.has(simklId)) {
              simklItems.set(simklId, {
                simklId, title: item.title, category,
                tmdbId:   item.ids?.tmdb ? String(item.ids.tmdb) : null,
                tmdbType: category === 'series' ? 'tv' : 'movie',
              });
            }
          }
        }
      }

      console.log(`[worldmap/simkl] ${simklItems.size} items`);

      // Check library_items DB cache (old scheme)
      const allIds  = [...simklItems.keys()];
      const dbCodes = new Map();
      const CHUNK   = 500;
      for (let i = 0; i < allIds.length; i += CHUNK) {
        const chunk = allIds.slice(i, i + CHUNK);
        const ph    = chunk.map(() => '?').join(',');
        const rows  = await db.all(
          `SELECT external_id, country_code FROM library_items
           WHERE user_id = ? AND external_id IN (${ph}) AND country_code IS NOT NULL`,
          [req.userId, ...chunk]
        );
        for (const r of rows) dbCodes.set(r.external_id, r.country_code);
      }

      // Separate anime (JP) from items needing TMDB lookup
      const tmdbItems  = [];
      const toUpdateDb = [];

      for (const [simklId, item] of simklItems) {
        if (item.category === 'anime') {
          if (!dbCodes.has(simklId)) toUpdateDb.push({ simklId, code: 'JP' });
          addCountry(countries, 'JP', item.title);
        } else if (dbCodes.has(simklId)) {
          addCountry(countries, dbCodes.get(simklId), item.title);
        } else if (item.tmdbId) {
          tmdbItems.push(item);
        }
      }

      // TMDB lookup for non-anime items
      if (tmdbKey && tmdbItems.length > 0) {
        const pairs      = tmdbItems.map(i => ({ tmdbId: i.tmdbId, tmdbType: i.tmdbType }));
        const tmdbCached = await tmdbCacheGet(pairs);
        const partial    = await lookupTmdb(tmdbItems, tmdbKey, tmdbCached);
        for (const [k, v] of Object.entries(partial)) {
          if (!countries[k]) countries[k] = { count: 0, titles: [] };
          countries[k].count  += v.count;
          countries[k].titles  = [...countries[k].titles, ...v.titles].slice(0, 5);
        }
        // Also persist to library_items for backward compat
        const more = [];
        for (const item of tmdbItems) {
          const code = tmdbCached.get(`${item.tmdbId}:${item.tmdbType}`);
          if (code) more.push({ simklId: item.simklId, code });
        }
        toUpdateDb.push(...more);
      } else if (!tmdbKey && tmdbItems.length > 0) {
        console.log(`[worldmap/simkl] skipping ${tmdbItems.length} items (no TMDB key)`);
      }

      if (toUpdateDb.length > 0) {
        await db.batch(toUpdateDb.map(({ simklId, code }) => ({
          sql:  'UPDATE library_items SET country_code = ? WHERE user_id = ? AND external_id = ?',
          args: [code, req.userId, simklId],
        })));
      }
    }

    // ── Jellyfin sync ─────────────────────────────────────────────────────
    if (doJF) {
      const userRow = await db.get(
        'SELECT server_url, jellyfin_id, jellyfin_token FROM users WHERE username = ?',
        [req.userId]
      );

      if (!userRow?.server_url || !userRow?.jellyfin_token) {
        const msg = userRow?.server_url
          ? 'Jellyfin token missing — please log out and back in to refresh it.'
          : 'This account is not connected to a Jellyfin server.';
        // Return what we have so far rather than failing hard
        if (!fresh) return res.status(400).json({ error: msg });
        console.warn('[worldmap/jellyfin]', msg);
      } else {
        try {
          const items = await getWatchedItems(
            userRow.server_url, userRow.jellyfin_id, userRow.jellyfin_token
          );
          console.log(`[worldmap/jellyfin] ${items.length} watched items`);

          // Ensure jf_watched_cache table exists
          await db.exec(`
            CREATE TABLE IF NOT EXISTS jf_watched_cache (
              user_id     TEXT NOT NULL,
              jf_id       TEXT NOT NULL,
              country_code TEXT,
              PRIMARY KEY (user_id, jf_id)
            )
          `);

          // Identify what's already cached
          const jfIds = items.map(i => i.Id);
          const cachedJf = new Map();
          const JF_CHUNK = 500;
          for (let i = 0; i < jfIds.length; i += JF_CHUNK) {
            const chunk = jfIds.slice(i, i + JF_CHUNK);
            const ph    = chunk.map(() => '?').join(',');
            const rows  = await db.all(
              `SELECT jf_id, country_code FROM jf_watched_cache
               WHERE user_id = ? AND jf_id IN (${ph})`,
              [req.userId, ...chunk]
            );
            for (const r of rows) cachedJf.set(r.jf_id, r.country_code);
          }

          const tmdbItems  = [];
          const directItems= []; // items that got country from ProductionLocations
          const newJfRows  = []; // to persist

          for (const item of items) {
            const jfId = item.Id;
            if (cachedJf.has(jfId)) {
              const code = cachedJf.get(jfId);
              if (code) addCountry(countries, code, item.Name);
              continue;
            }

            const tmdbId = item.ProviderIds?.Tmdb || item.ProviderIds?.tmdb || null;
            const tmdbType = item.Type === 'Movie' ? 'movie' : 'tv';

            if (tmdbId) {
              tmdbItems.push({ jfId, tmdbId: String(tmdbId), tmdbType, title: item.Name });
            } else if (item.ProductionLocations?.length) {
              // Fallback: map Jellyfin country names → ISO codes
              const code = COUNTRY_NAME_TO_CODE[item.ProductionLocations[0]] || null;
              if (code) {
                addCountry(countries, code, item.Name);
                newJfRows.push({ jfId, code });
              }
            }
          }

          // TMDB lookup for uncached Jellyfin items
          if (tmdbItems.length > 0) {
            const pairs      = tmdbItems.map(i => ({ tmdbId: i.tmdbId, tmdbType: i.tmdbType }));
            const tmdbCached = await tmdbCacheGet(pairs);

            if (tmdbKey) {
              await lookupTmdb(tmdbItems, tmdbKey, tmdbCached);
            }

            for (const item of tmdbItems) {
              const code = tmdbCached.get(`${item.tmdbId}:${item.tmdbType}`);
              if (code) {
                addCountry(countries, code, item.title);
                newJfRows.push({ jfId: item.jfId, code });
              } else {
                newJfRows.push({ jfId: item.jfId, code: null }); // cache miss so we don't re-query
              }
            }
          }

          // Persist Jellyfin cache
          if (newJfRows.length > 0) {
            await db.batch(newJfRows.map(({ jfId, code }) => ({
              sql:  'INSERT OR REPLACE INTO jf_watched_cache (user_id, jf_id, country_code) VALUES (?, ?, ?)',
              args: [req.userId, jfId, code],
            })));
          }
        } catch (e) {
          console.error('[worldmap/jellyfin]', e.message);
          // Don't fail the whole request, just skip Jellyfin
          if (!fresh) return res.status(502).json({ error: e.message });
        }
      }
    }

    // If neither Simkl nor Jellyfin was synced, fall back to DB fast path
    if (!fresh && !doJF) {
      // This branch is unreachable given the early return above, but kept for safety
    }

    // Merge with existing Simkl DB data when only doing Jellyfin sync
    if (!fresh && doJF) {
      const rows = await db.all(
        'SELECT title, category, country_code FROM library_items WHERE user_id = ? AND country_code IS NOT NULL',
        [req.userId]
      );
      const animeRows = await db.all(
        "SELECT title FROM library_items WHERE user_id = ? AND category = 'anime' AND country_code IS NULL",
        [req.userId]
      );
      for (const r of rows)      addCountry(countries, r.country_code, r.title);
      for (const r of animeRows) addCountry(countries, 'JP',           r.title);
    }

    const data = { countries };
    memCache.set(req.userId, { data, fetchedAt: now });
    res.json(data);
  } catch (e) {
    console.error('[worldmap]', e);
    res.status(500).json({ error: e.message });
  }
});

// Common Jellyfin ProductionLocations → ISO alpha-2 fallback map
const COUNTRY_NAME_TO_CODE = {
  'United States':         'US', 'United States of America': 'US',
  'United Kingdom':        'GB', 'UK': 'GB',
  'Japan':                 'JP',
  'Germany':               'DE',
  'France':                'FR',
  'Canada':                'CA',
  'Australia':             'AU',
  'South Korea':           'KR', 'Korea':   'KR',
  'China':                 'CN',
  'Italy':                 'IT',
  'Spain':                 'ES',
  'Brazil':                'BR',
  'Mexico':                'MX',
  'Sweden':                'SE',
  'Denmark':               'DK',
  'Norway':                'NO',
  'Finland':               'FI',
  'Netherlands':           'NL',
  'Belgium':               'BE',
  'Austria':               'AT',
  'Switzerland':           'CH',
  'Russia':                'RU',
  'India':                 'IN',
  'Ireland':               'IE',
  'New Zealand':           'NZ',
  'Poland':                'PL',
  'Czech Republic':        'CZ',
  'Hong Kong':             'HK',
  'Thailand':              'TH',
  'Argentina':             'AR',
  'Turkey':                'TR',
  'Israel':                'IL',
  'Portugal':              'PT',
  'Hungary':               'HU',
  'Romania':               'RO',
  'Greece':                'GR',
  'South Africa':          'ZA',
  'Philippines':           'PH',
  'Indonesia':             'ID',
  'Taiwan':                'TW',
};

module.exports = router;
