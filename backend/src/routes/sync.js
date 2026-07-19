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
  catch (e) { res.status(500).json({ error: e.message }); }
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
    else if (category === 'comics') res.json(await syncGoogleBooks(opts));
    else if (category === 'anime' || category === 'manga') res.json(await syncAniList(req.userId));
    else res.json({ updated: 0, skipped: 0 });
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
