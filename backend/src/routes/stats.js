const express = require('express');
const router = express.Router();
const { db } = require('../database');

const COLLECTION_BONUS_PER_ENTRY = {
  movies: 10, series: 20, anime: 20, manga: 10, games: 15, comics: 10, albums: 10,
};

router.get('/', async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT category, count, total_progress, total_game_hours, games_with_hltb FROM completion_stats WHERE user_id = ?',
      [req.userId]
    );
    const counts = {}, progress = {};
    let gameHours = 0, gamesWithHltb = 0;
    for (const r of rows) {
      counts[r.category] = Number(r.count);
      progress[r.category] = Number(r.total_progress || 0);
      if (r.category === 'games') {
        gameHours = Number(r.total_game_hours || 0);
        gamesWithHltb = Number(r.games_with_hltb || 0);
      }
    }

    let collectionBonus = 0;
    try {
      const cols = await db.all(`
        SELECT c.category, COUNT(ci.id) as total,
               SUM(CASE WHEN ci.completed_at IS NOT NULL THEN 1 ELSE 0 END) as done
        FROM collections c
        JOIN collection_items ci ON ci.collection_id = c.id
        WHERE c.user_id = ?
        GROUP BY c.id
        HAVING done >= total AND total >= 2
      `, [req.userId]);
      for (const col of cols) {
        collectionBonus += Number(col.total) * (COLLECTION_BONUS_PER_ENTRY[col.category] || 10);
      }
    } catch { /* collections table may not exist yet on first boot */ }

    res.json({ counts, progress, gameHours, gamesWithHltb, collectionBonus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
