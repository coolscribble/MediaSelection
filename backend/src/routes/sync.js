const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { getPin, pollPin, syncSimkl } = require('../services/simkl');
const { syncAniList, updateOngoingAiringInfo } = require('../services/anilist');
const { syncMAL } = require('../services/mal');
const { syncIGDB } = require('../services/igdb');
const { syncAOTY } = require('../services/aoty');
const { syncComicVine } = require('../services/comicvine');
const { syncGoogleBooks } = require('../services/googlebooks');
const { importPSNGames } = require('../services/psn');
const { importSteamGames } = require('../services/steam');
const { importXboxGames } = require('../services/xbox');
const { getRequestToken, authorizeAndImport, reimport: tmdbReimport } = require('../services/tmdb');

router.get('/simkl/pin', async (req, res) => {
  try {
    const row = await db.get(
      'SELECT value FROM settings WHERE user_id = ? AND key = ?',
      [req.userId, 'simkl_client_id']
    );
    if (!row?.value) return res.status(400).json({ error: 'Set Simkl Client ID in Settings first' });
    res.json(await getPin(row.value));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/simkl/pin/:usercode', async (req, res) => {
  if (!/^[A-Z0-9]{4,12}$/i.test(req.params.usercode)) {
    return res.status(400).json({ error: 'Invalid PIN code format' });
  }
  try {
    const row = await db.get(
      'SELECT value FROM settings WHERE user_id = ? AND key = ?',
      [req.userId, 'simkl_client_id']
    );
    if (!row?.value) return res.status(400).json({ error: 'Simkl Client ID is missing' });
    const token = await pollPin(row.value, req.params.usercode);
    if (token) {
      await db.run(
        'INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)',
        [req.userId, 'simkl_access_token', token]
      );
    }
    res.json({ authorized: Boolean(token) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/simkl', async (req, res) => {
  try { res.json(await syncSimkl(req.userId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/anilist', async (req, res) => {
  try { res.json(await syncAniList(req.userId)); }
  catch (e) {
    const msg = e.name === 'AbortError' ? 'AniList request timed out — their API may be overloaded. Try again in a moment.' : e.message;
    res.status(500).json({ error: msg });
  }
});

router.post('/mal', async (req, res) => {
  try { res.json(await syncMAL(req.userId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/igdb', async (req, res) => {
  try { res.json(await syncIGDB({ userId: req.userId })) }
  catch (e) { res.status(500).json({ error: e.message }) }
});

router.post('/aoty', async (req, res) => {
  try { res.json(await syncAOTY({ userId: req.userId })) }
  catch (e) { res.status(500).json({ error: e.message }) }
});

router.post('/comicvine', async (req, res) => {
  const { itemId } = req.body || {};
  const opts = { userId: req.userId, ...(itemId ? { itemId: Number(itemId) } : {}) };
  try { res.json(await syncComicVine(opts)) }
  catch (e) { res.status(500).json({ error: e.message }) }
});

router.post('/googlebooks', async (req, res) => {
  try { res.json(await syncGoogleBooks({ userId: req.userId })) }
  catch (e) { res.status(500).json({ error: e.message }) }
});

router.post('/covers/:category', async (req, res) => {
  const { category } = req.params;
  const { itemId } = req.body || {};
  const opts = { userId: req.userId, ...(itemId ? { itemId: Number(itemId) } : {}) };
  try {
    if (category === 'games') res.json(await syncIGDB(opts));
    else if (category === 'albums') res.json(await syncAOTY(opts));
    else if (category === 'comics') {
      let useCV = false;
      if (opts.itemId) {
        const row = await db.get(
          "SELECT external_id FROM library_items WHERE id = ? AND user_id = ? AND category = 'comics'",
          [opts.itemId, req.userId]
        );
        useCV = !!row?.external_id;
      }
      res.json(useCV ? await syncComicVine(opts) : await syncGoogleBooks(opts));
    }
    else if (category === 'anime' || category === 'manga') res.json(await syncAniList(req.userId));
    else if (category === 'series' || category === 'movies') res.json(await syncSimkl(req.userId));
    else res.json({ updated: 0, skipped: 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/psn', async (req, res) => {
  const { npsso, skipCompleted, platforms } = req.body || {};
  if (!npsso || typeof npsso !== 'string' || npsso.trim().length < 10) {
    return res.status(400).json({ error: 'Invalid or missing NPSSO token' });
  }
  try {
    res.json(await importPSNGames({
      userId: req.userId,
      npsso: npsso.trim(),
      skipCompleted: Boolean(skipCompleted),
      platforms: Array.isArray(platforms) && platforms.length > 0 ? platforms : null,
    }));
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('npsso') || msg.includes('401') || msg.includes('Unauthorized')) {
      return res.status(401).json({ error: 'Invalid NPSSO token — please get a fresh one from PSN' });
    }
    res.status(500).json({ error: msg });
  }
});

router.post('/steam', async (req, res) => {
  const { steamId, sessionCookie } = req.body || {};
  if (!steamId?.trim()) return res.status(400).json({ error: 'Steam username or profile URL is required' });
  if (!sessionCookie?.trim()) return res.status(400).json({ error: 'Steam session cookie is required' });
  try {
    res.json(await importSteamGames({ userId: req.userId, steamId, sessionCookie }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/xbox', async (req, res) => {
  const { gamertag } = req.body || {};
  if (!gamertag?.trim()) return res.status(400).json({ error: 'Gamertag is required' });
  try {
    const keyRow = await db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [req.userId, 'xbox_xbl_key']);
    if (!keyRow?.value) return res.status(400).json({ error: 'Set your xbl.io API key in Settings first' });
    res.json(await importXboxGames({ userId: req.userId, gamertag, apiKey: keyRow.value }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tmdb/request-token', async (req, res) => {
  try {
    const keyRow = await db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [req.userId, 'tmdb_api_key']);
    if (!keyRow?.value) return res.status(400).json({ error: 'Set your TMDB API key in Settings first' });
    res.json(await getRequestToken(keyRow.value));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tmdb/import', async (req, res) => {
  const { requestToken } = req.body || {};
  try {
    const keyRow = await db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [req.userId, 'tmdb_api_key']);
    if (!keyRow?.value) return res.status(400).json({ error: 'Set your TMDB API key in Settings first' });
    const result = requestToken
      ? await authorizeAndImport({ userId: req.userId, apiKey: keyRow.value, requestToken })
      : await tmdbReimport({ userId: req.userId, apiKey: keyRow.value });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/update-metadata', async (req, res) => {
  const result = {};
  try { result.anilist = await syncAniList(req.userId) } catch (e) { result.anilist_error = e.message }
  try { result.simkl   = await syncSimkl(req.userId)   } catch (e) { result.simkl_error   = e.message }
  try { result.ongoing = await updateOngoingAiringInfo(req.userId) } catch (e) { result.ongoing_error = e.message }
  try { result.igdb    = await syncIGDB({ userId: req.userId })    } catch (e) { result.igdb_error    = e.message }
  res.json(result);
});

module.exports = router;
