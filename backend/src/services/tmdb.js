const { db } = require('../database');

const BASE = 'https://api.themoviedb.org/3';

async function getRequestToken(apiKey) {
  const r = await fetch(`${BASE}/authentication/token/new?api_key=${encodeURIComponent(apiKey)}`);
  const d = await r.json();
  if (!d.success) throw new Error('TMDB rejected the API key. Check your v3 API key at themoviedb.org/settings/api.');
  return {
    requestToken: d.request_token,
    approveUrl: `https://www.themoviedb.org/authenticate/${d.request_token}`,
  };
}

async function _fetchWatchlist(apiKey, sessionId, accountId) {
  let page = 1, totalPages = 1;
  const movies = [];
  while (page <= totalPages) {
    const r = await fetch(
      `${BASE}/account/${accountId}/watchlist/movies?api_key=${encodeURIComponent(apiKey)}&session_id=${sessionId}&page=${page}`
    );
    if (r.status === 401) throw new Error('TMDB session expired — please re-authorize.');
    const d = await r.json();
    movies.push(...(d.results ?? []));
    totalPages = d.total_pages ?? 1;
    page++;
  }
  return movies;
}

async function _insertMovies(userId, movies) {
  let added = 0, already = 0;
  for (const m of movies) {
    const name = (m.title || m.original_title || '').trim();
    if (!name) continue;
    const extId = String(m.id);
    const dup = await db.get(
      "SELECT id FROM library_items WHERE user_id = ? AND category = 'movies' AND (external_id = ? OR LOWER(title) = LOWER(?))",
      [userId, extId, name]
    );
    if (dup) { already++; continue; }
    const cover = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null;
    await db.run(
      'INSERT INTO library_items (user_id, category, title, thumbnail_url, external_id, metadata, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, 'movies', name, cover, extId,
        JSON.stringify({ year: (m.release_date || '').substring(0, 4), tmdb_id: m.id }),
        'tmdb']
    );
    added++;
  }
  return { added, already };
}

async function authorizeAndImport({ userId, apiKey, requestToken }) {
  // Exchange approved request token for session
  const sr = await fetch(`${BASE}/authentication/session/new?api_key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_token: requestToken }),
  });
  const sd = await sr.json();
  if (!sd.success) throw new Error('Token not approved yet — visit the TMDB link and approve it first.');
  const sessionId = sd.session_id;

  const ar = await fetch(`${BASE}/account?api_key=${encodeURIComponent(apiKey)}&session_id=${sessionId}`);
  const account = await ar.json();
  const accountId = account.id;

  await db.run('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)', [userId, 'tmdb_session_id', sessionId]);
  await db.run('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)', [userId, 'tmdb_account_id', String(accountId)]);

  const movies = await _fetchWatchlist(apiKey, sessionId, accountId);
  const counts = await _insertMovies(userId, movies);
  return { ...counts, total: movies.length };
}

async function reimport({ userId, apiKey }) {
  const sessionRow = await db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'tmdb_session_id']);
  const accountRow = await db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'tmdb_account_id']);
  if (!sessionRow?.value || !accountRow?.value) throw new Error('TMDB not authorized — use Get Auth Link first.');
  const movies = await _fetchWatchlist(apiKey, sessionRow.value, accountRow.value);
  const counts = await _insertMovies(userId, movies);
  return { ...counts, total: movies.length };
}

module.exports = { getRequestToken, authorizeAndImport, reimport };
