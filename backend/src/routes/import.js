const express = require('express');
const router = express.Router();
const multer = require('multer');
const { importCSV } = require('../services/csv');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const VALID = ['movies', 'series', 'anime', 'manga', 'games', 'comics', 'albums'];

router.post('/csv/:category', upload.single('file'), async (req, res) => {
  if (!VALID.includes(req.params.category)) return res.status(400).json({ error: 'Invalid category' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const count = await importCSV(req.file.buffer, req.params.category);
    res.json({ imported: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
