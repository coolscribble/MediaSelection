const { db } = require('../database');

const JIKAN = 'https://api.jikan.moe/v4';

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url) {
  await delay(400); // Jikan rate limit: 3 req/s
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Jikan API error ${res.status}: ${url}`);
  return res.json();
}

async function importList(username, listType, status, category) {
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
        'SELECT id FROM library_items WHERE category = ? AND external_id = ?',
        [category, extId]
      );
      if (existing) {
        await db.run(
          'UPDATE library_items SET thumbnail_url = ?, metadata = ? WHERE id = ?',
          [thumb, metadata, existing.id]
        );
      } else {
        await db.run(
          'INSERT INTO library_items (category, title, external_id, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?, ?)',
          [category, title, extId, thumb, metadata, 'mal']
        );
        count++;
      }
    }

    if (!json.pagination?.has_next_page) break;
    page++;
  }
  return count;
}

async function syncMAL() {
  const userRow = await db.get('SELECT value FROM settings WHERE key = ?', ['mal_username']);
  if (!userRow?.value) throw new Error('MAL username is not configured');

  const [aniStatesRow, mangaStatesRow] = await Promise.all([
    db.get('SELECT value FROM settings WHERE key = ?', ['mal_anime_states']),
    db.get('SELECT value FROM settings WHERE key = ?', ['mal_manga_states']),
  ]);
  const animeStates = aniStatesRow?.value ? JSON.parse(aniStatesRow.value) : ['plantowatch'];
  const mangaStates = mangaStatesRow?.value ? JSON.parse(mangaStatesRow.value) : ['plantoread'];

  let animeCount = 0, mangaCount = 0;
  for (const status of animeStates) {
    animeCount += await importList(userRow.value, 'animelist', status, 'anime');
  }
  for (const status of mangaStates) {
    mangaCount += await importList(userRow.value, 'mangalist', status, 'manga');
  }
  return { anime: animeCount, manga: mangaCount };
}

module.exports = { syncMAL };
