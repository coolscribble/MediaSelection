const express = require('express');
const router = express.Router();
const { db } = require('../database');

router.get('/', async (req, res) => {
  try {
    const rows = await db.all('SELECT category, count FROM completion_stats WHERE count > 0');
    const result = {};
    for (const r of rows) result[r.category] = Number(r.count);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
