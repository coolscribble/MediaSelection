const { db } = require('../database');

const BASE = 'https://api.simkl.com';

async function getPin(clientId) {
  const res = await fetch(`${BASE}/oauth/pin?client_id=${clientId}`);
  if (!res.ok) throw new Error(`Simkl PIN error: ${res.status}`);
  return res.json();
}

async function pollPin(clientId, userCode) {
  const res = await fetch(`${BASE}/oauth/pin/${userCode}?client_id=${clientId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return (data.result === 'KO' || !data.access_token) ? null : data.access_token;
}

async function syncSimkl() {
  const [cidRow, tokenRow, statesRow] = await Promise.all([
    db.get('SELECT value FROM settings WHERE key = ?', ['simkl_client_id']),
    db.get('SELECT value FROM settings WHERE key = ?', ['simkl_access_token']),
    db.get('SELECT value FROM settings WHERE key = ?', ['simkl_states']),
  ]);
  if (!cidRow?.value || !tokenRow?.value) throw new Error('Simkl is not configured (missing Client ID or token)');

  const states = statesRow?.value ? JSON.parse(statesRow.value) : ['plantowatch'];
  const headers = {
    Authorization: `Bearer ${tokenRow.value}`,
    'simkl-api-key': cidRow.value,
    'Content-Type': 'application/json',
  };

  const counts = { movies: 0, series: 0, anime: 0 };

  for (const status of states) {
    for (const [type, category] of [['movies', 'movies'], ['shows', 'series'], ['anime', 'anime']]) {
      const res = await fetch(`${BASE}/sync/all-items/${status}/${type}`, { headers });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`Simkl API error (${status}/${type}): ${res.status}`);
      const data = await res.json();

      const key = type === 'movies' ? 'movie' : type === 'shows' ? 'show' : 'anime';
      for (const entry of (data[type] || [])) {
        const item = entry[key];
        if (!item) continue;
        const extId = item.ids?.simkl ? String(item.ids.simkl) : null;
        const thumb = item.poster ? `https://simkl.in/posters/${item.poster}_m.jpg` : null;
        const total = item.total_episodes || item.episode_count || null;
        const metadata = JSON.stringify({ year: item.year, status, total });

        if (extId) {
          const existing = await db.get(
            'SELECT id FROM library_items WHERE category = ? AND external_id = ?',
            [category, extId]
          );
          if (existing) {
            await db.run(
              'UPDATE library_items SET thumbnail_url = ?, metadata = ? WHERE id = ?',
              [thumb, metadata, existing.id]
            );
            continue;
          }
        }
        await db.run(
          'INSERT INTO library_items (category, title, external_id, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?, ?)',
          [category, item.title, extId, thumb, metadata, 'simkl']
        );
        counts[category]++;
      }
    }
  }

  return counts;
}

module.exports = { getPin, pollPin, syncSimkl };
