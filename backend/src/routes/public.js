const express = require('express');
const router = express.Router();
const { db } = require('../database');

const CATS = ['movies', 'series', 'anime', 'manga', 'games', 'comics', 'albums'];

router.get('/:username', async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  try {
    const user = await db.get('SELECT username FROM users WHERE username = ?', [username]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const setting = await db.get(
      'SELECT value FROM settings WHERE user_id = ? AND key = ?',
      [username, 'public_profile']
    );
    if (setting?.value !== 'true') {
      return res.status(403).json({ error: 'This profile is private' });
    }

    const slots = {};
    for (const cat of CATS) {
      slots[cat] = await db.all(
        `SELECT s.slot_index, s.is_locked, s.note, s.current_progress,
                l.title, l.thumbnail_url, l.metadata
         FROM slots s
         LEFT JOIN library_items l ON s.item_id = l.id
         WHERE s.user_id = ? AND s.category = ?
         ORDER BY s.slot_index`,
        [username, cat]
      );
    }

    const library_counts = {};
    for (const cat of CATS) {
      const row = await db.get(
        'SELECT COUNT(*) as cnt FROM library_items WHERE user_id = ? AND category = ?',
        [username, cat]
      );
      library_counts[cat] = row?.cnt ?? 0;
    }

    res.json({ username, slots, library_counts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
