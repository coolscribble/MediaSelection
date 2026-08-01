'use strict';
const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { simklQS, simklHeaders } = require('../services/simkl');

const BASE = 'https://api.simkl.com';
const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map();

router.get('/', async (req, res) => {
  try {
    const [cidRow, tokenRow] = await Promise.all([
      db.get("SELECT value FROM settings WHERE user_id = ? AND key = 'simkl_client_id'", [req.userId]),
      db.get("SELECT value FROM settings WHERE user_id = ? AND key = 'simkl_access_token'", [req.userId]),
    ]);

    if (!cidRow?.value || !tokenRow?.value) {
      return res.status(400).json({ error: 'Simkl not configured. Connect Simkl in Settings first.' });
    }

    const now = Date.now();
    const fresh = req.query.fresh === 'true' || req.query.fresh === '1';
    const cached = cache.get(req.userId);
    if (!fresh && cached && now - cached.fetchedAt < CACHE_TTL) {
      return res.json(cached.data);
    }

    const cid = cidRow.value;
    const token = tokenRow.value;
    const headers = simklHeaders(token, cid);
    const countries = {};

    const TYPES = [
      { type: 'movies', key: 'movie' },
      { type: 'shows',  key: 'show'  },
      { type: 'anime',  key: 'anime' },
    ];

    for (const { type, key } of TYPES) {
      for (const status of ['completed', 'watching']) {
        const qs = simklQS(cid, { extended: 'full' });
        const r = await fetch(`${BASE}/sync/all-items/${status}/${type}?${qs}`, { headers });
        if (r.status === 404) continue;
        if (!r.ok) { console.warn(`[worldmap] ${status}/${type}: ${r.status}`); continue; }
        const data = await r.json();
        for (const entry of (data[type] || [])) {
          const item = entry[key];
          if (!item?.country) continue;
          const code = item.country.toUpperCase();
          if (!countries[code]) countries[code] = { count: 0, titles: [] };
          countries[code].count++;
          if (countries[code].titles.length < 5) countries[code].titles.push(item.title);
        }
      }
    }

    const data = { countries };
    cache.set(req.userId, { data, fetchedAt: now });
    res.json(data);
  } catch (e) {
    console.error('[worldmap]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
