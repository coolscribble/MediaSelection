const express = require('express');
const router = express.Router();
const { db } = require('../database');

router.get('/', async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT category, count, total_progress FROM completion_stats WHERE user_id = ?',
      [req.userId]
    );
    const counts = {}, progress = {};
    for (const r of rows) {
      counts[r.category] = Number(r.count);
      progress[r.category] = Number(r.total_progress || 0);
    }
    res.json({ counts, progress });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
