const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { getPin, pollPin, syncSimkl } = require('../services/simkl');
const { syncAniList, updateOngoingAiringInfo } = require('../services/anilist');
const { syncMAL } = require('../services/mal');
const { syncIGDB } = require('../services/igdb');
const { syncAOTY } = require('../services/aoty');

router.get('/simkl/pin', async (req, res) => {
  try {
    const row = await db.get('SELECT value FROM settings WHERE key = ?', ['simkl_client_id']);
    if (!row?.value) return res.status(400).json({ error: 'Set Simkl Client ID in Settings first' });
    res.json(await getPin(row.value));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/simkl/pin/:usercode', async (req, res) => {
  try {
    const row = await db.get('SELECT value FROM settings WHERE key = ?', ['simkl_client_id']);
    if (!row?.value) return res.status(400).json({ error: 'Simkl Client ID is missing' });
    const token = await pollPin(row.value, req.params.usercode);
    if (token) await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['simkl_access_token', token]);
    res.json({ authorized: Boolean(token) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/simkl', async (req, res) => {
  try { res.json(await syncSimkl()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/anilist', async (req, res) => {
  try { res.json(await syncAniList()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/mal', async (req, res) => {
  try { res.json(await syncMAL()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Fetch IGDB covers only (faster than full update-metadata)
router.post('/igdb', async (req, res) => {
  try { res.json(await syncIGDB()) }
  catch (e) { res.status(500).json({ error: e.message }) }
});

// Fetch Album of the Year covers only
router.post('/aoty', async (req, res) => {
  try { res.json(await syncAOTY()) }
  catch (e) { res.status(500).json({ error: e.message }) }
});

// Refresh metadata (episode counts, airing info, IGDB covers) for all existing items
router.post('/update-metadata', async (req, res) => {
  const result = {};
  try { result.anilist = await syncAniList() } catch (e) { result.anilist_error = e.message }
  try { result.simkl = await syncSimkl() } catch (e) { result.simkl_error = e.message }
  try { result.ongoing = await updateOngoingAiringInfo() } catch (e) { result.ongoing_error = e.message }
  // IGDB is optional — only runs if credentials are configured
  try { result.igdb = await syncIGDB() } catch (e) { result.igdb_error = e.message }
  res.json(result);
});

module.exports = router;
