const { db } = require('../database');

const JIKAN = 'https://api.jikan.moe/v4';

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url) {
  await delay(600);
  const MAX_RETRIES = 4;
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await delay(1500 * Math.pow(2, attempt - 1)); // 1.5s, 3s, 6s
    const res = await fetch(url, { headers: { 'User-Agent': 'mediapicker/1.0' } });
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    // Parse Jikan's error body for a useful message
    let jikanMsg = `status ${res.status}`;
    try {
      const body = await res.json();
      if (body.message) jikanMsg = body.message;
    } catch {}
    lastErr = new Error(`Jikan: ${jikanMsg}`);
    // Only retry on server-side errors
    if (res.status < 500) throw lastErr;
  }
  throw lastErr;
}

async function importList(userId, username, listType, status, category) {
  let page = 1;
  let count = 0;

  while (true) {
    const json = await fetchPage(`${JIKAN}/users/${username}/${listType}?status=${status}&page=${page}`);
    if (!json) break;
    const items = json.data || [];
    if (!items.length) break;

    for (const item of items) {
      const extId = `mal_${item.mal_id}`;
      const title = item.title || 'Unknown';
      const thumb = item.images?.jpg?.image_url || item.images?.jpg?.small_image_url || null;
      const total = listType === 'animelist' ? (item.num_episodes || null) : (item.num_chapters || null);
      const metadata = JSON.stringify({ total, status });

      const existing = await db.get(
        'SELECT id FROM library_items WHERE user_id = ? AND category = ? AND external_id = ?',
        [userId, category, extId]
      );
      if (existing) {
        await db.run(
          'UPDATE library_items SET thumbnail_url = ?, metadata = ? WHERE id = ?',
          [thumb, metadata, existing.id]
        );
      } else {
        await db.run(
          'INSERT INTO library_items (user_id, category, title, external_id, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [userId, category, title, extId, thumb, metadata, 'mal']
        );
        count++;
      }
    }

    if (!json.pagination?.has_next_page) break;
    page++;
  }
  return count;
}

async function syncMAL(userId) {
  const userRow = await db.get(
    'SELECT value FROM settings WHERE user_id = ? AND key = ?',
    [userId, 'mal_username']
  );
  if (!userRow?.value) throw new Error('MAL username is not configured');

  const [aniStatesRow, mangaStatesRow] = await Promise.all([
    db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'mal_anime_states']),
    db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'mal_manga_states']),
  ]);
  const animeStates = aniStatesRow?.value ? JSON.parse(aniStatesRow.value) : ['plantowatch'];
  const mangaStates = mangaStatesRow?.value ? JSON.parse(mangaStatesRow.value) : ['plantoread'];

  let animeCount = 0, mangaCount = 0;
  for (const status of animeStates) {
    animeCount += await importList(userId, userRow.value, 'animelist', status, 'anime');
  }
  for (const status of mangaStates) {
    mangaCount += await importList(userId, userRow.value, 'mangalist', status, 'manga');
  }
  return { anime: animeCount, manga: mangaCount };
}

module.exports = { syncMAL };
