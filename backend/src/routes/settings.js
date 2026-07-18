const express = require('express');
const router = express.Router();
const { db } = require('../database');

const CATS = ['movies', 'series', 'anime', 'manga', 'games', 'comics', 'albums'];

const ANILIST_STATES_DEFAULT  = ['PLANNING'];
const SIMKL_STATES_DEFAULT    = ['plantowatch'];
const MAL_ANIME_STATES_DEFAULT = ['plantowatch'];
const MAL_MANGA_STATES_DEFAULT = ['plantoread'];

router.get('/', async (req, res) => {
  try {
    const rows = await db.all('SELECT key, value FROM settings');
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

    const queueModes = {};
    for (const c of CATS) queueModes[c] = map[`queue_mode_${c}`] === 'true';

    res.json({
      simkl_client_id:    map.simkl_client_id    || '',
      simkl_token_set:    Boolean(map.simkl_access_token),
      anilist_username:   map.anilist_username    || '',
      mal_username:       map.mal_username        || '',
      anilist_states:     JSON.parse(map.anilist_states     || JSON.stringify(ANILIST_STATES_DEFAULT)),
      simkl_states:       JSON.parse(map.simkl_states       || JSON.stringify(SIMKL_STATES_DEFAULT)),
      mal_anime_states:   JSON.parse(map.mal_anime_states   || JSON.stringify(MAL_ANIME_STATES_DEFAULT)),
      mal_manga_states:   JSON.parse(map.mal_manga_states   || JSON.stringify(MAL_MANGA_STATES_DEFAULT)),
      queue_modes:        queueModes,
      igdb_client_id:     map.igdb_client_id     || '',
      igdb_client_set:    Boolean(map.igdb_client_secret),
      aoty_api_set:       Boolean(map.aoty_api_key),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const upsert = (k, v) => db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, v]);

    const scalar = ['simkl_client_id', 'simkl_access_token', 'anilist_username', 'mal_username', 'igdb_client_id', 'igdb_client_secret', 'aoty_api_key'];
    for (const key of scalar) {
      if (req.body[key] !== undefined) await upsert(key, req.body[key]);
    }

    const jsonArr = ['anilist_states', 'simkl_states', 'mal_anime_states', 'mal_manga_states'];
    for (const key of jsonArr) {
      if (Array.isArray(req.body[key])) await upsert(key, JSON.stringify(req.body[key]));
    }

    if (req.body.queue_modes && typeof req.body.queue_modes === 'object') {
      for (const c of CATS) {
        if (req.body.queue_modes[c] !== undefined) {
          await upsert(`queue_mode_${c}`, req.body.queue_modes[c] ? 'true' : 'false');
        }
      }
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
