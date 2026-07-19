const express = require('express');
const router = express.Router();
const multer = require('multer');
const { importCSV, previewCSV } = require('../services/csv');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const VALID = ['movies', 'series', 'anime', 'manga', 'games', 'comics', 'albums'];

router.post('/preview/:category', upload.single('file'), async (req, res) => {
  if (!VALID.includes(req.params.category)) return res.status(400).json({ error: 'Invalid category' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    res.json(await previewCSV(req.file.buffer, req.params.category));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/csv/:category', upload.single('file'), async (req, res) => {
  if (!VALID.includes(req.params.category)) return res.status(400).json({ error: 'Invalid category' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    let platforms, acquisitionTypes;
    if (req.body.platforms) {
      try { platforms = JSON.parse(req.body.platforms); } catch {}
    }
    if (req.body.acquisitionTypes) {
      try { acquisitionTypes = JSON.parse(req.body.acquisitionTypes); } catch {}
    }
    const retro = req.body.retro === 'true';
    const result = await importCSV(req.file.buffer, req.params.category, {
      userId: req.userId,
      platforms,
      acquisitionTypes,
      retro,
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
