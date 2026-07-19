const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const COVERS_DIR = path.join(DATA_DIR, 'covers');

// Categorized files: /api/covers/{category}/{filename}
router.get('/:category/:filename', (req, res) => {
  const category = path.basename(req.params.category);
  const filename = path.basename(req.params.filename);
  const filepath = path.join(COVERS_DIR, category, filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('Not found');
  res.sendFile(filepath);
});

// Legacy flat files: /api/covers/{filename}
router.get('/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(COVERS_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('Not found');
  res.sendFile(filepath);
});

module.exports = router;
