const { db } = require('../database');

const BASE = 'https://api.simkl.com';
const APP_NAME = 'mediapicker';
const APP_VERSION = '1.9.3';

function simklQS(clientId, extra = {}) {
  return new URLSearchParams({
    client_id: clientId,
    'app-name': APP_NAME,
    'app-version': APP_VERSION,
    ...extra,
  }).toString();
}

function simklHeaders(token, clientId) {
  return {
    Authorization: `Bearer ${token}`,
    'simkl-api-key': clientId,
    'Content-Type': 'application/json',
    'User-Agent': `${APP_NAME}/${APP_VERSION}`,
  };
}

async function getPin(clientId) {
  const res = await fetch(`${BASE}/oauth/pin?${simklQS(clientId)}`);
  if (!res.ok) throw new Error(`Simkl PIN error: ${res.status}`);
  return res.json();
}

async function pollPin(clientId, userCode) {
  const res = await fetch(`${BASE}/oauth/pin/${userCode}?${simklQS(clientId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return (data.result === 'KO' || !data.access_token) ? null : data.access_token;
}

async function syncSimkl(userId) {
  const [cidRow, tokenRow, statesRow, lastActRow] = await Promise.all([
    db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'simkl_client_id']),
    db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'simkl_access_token']),
    db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'simkl_states']),
    db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'simkl_last_activities']),
  ]);
  if (!cidRow?.value || !tokenRow?.value) throw new Error('Simkl is not configured (missing Client ID or token)');

  const cid = cidRow.value;
  const token = tokenRow.value;
  const headers = simklHeaders(token, cid);
  const states = statesRow?.value ? JSON.parse(statesRow.value) : ['plantowatch'];
  const savedActivities = lastActRow?.value ? JSON.parse(lastActRow.value) : null;

  const actRes = await fetch(`${BASE}/sync/activities?${simklQS(cid)}`, { headers });
  if (!actRes.ok) throw new Error(`Simkl activities error: ${actRes.status}`);
  const activities = await actRes.json();
  const currentAll = activities.all;

  if (savedActivities?.all && savedActivities.all === currentAll) {
    return { movies: 0, series: 0, anime: 0, skipped: true };
  }

  const dateFrom = savedActivities?.all || null;
  const counts = { movies: 0, series: 0, anime: 0 };

  for (const status of states) {
    for (const [type, category] of [['movies', 'movies'], ['shows', 'series'], ['anime', 'anime']]) {
      const qs = simklQS(cid, { ...(dateFrom ? { date_from: dateFrom } : {}), extended: 'full' });
      const res = await fetch(`${BASE}/sync/all-items/${status}/${type}?${qs}`, { headers });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`Simkl API error (${status}/${type}): ${res.status}`);
      const data = await res.json();

      const key = type === 'movies' ? 'movie' : type === 'shows' ? 'show' : 'anime';
      for (const entry of (data[type] || [])) {
        const item = entry[key];
        if (!item) continue;
        const extId = item.ids?.simkl ? String(item.ids.simkl) : null;
        const thumb = item.poster ? `https://simkl.in/posters/${item.poster}_m.webp` : null;
        const total = entry.total_episodes_count ?? item.total_episodes ?? item.episode_count ?? null;
        const tmdbId = item.ids?.tmdb ? Number(item.ids.tmdb) : null;
        const metadata = JSON.stringify({ year: item.year, status, total, ...(tmdbId ? { tmdb_id: tmdbId } : {}) });

        if (extId) {
          const existing = await db.get(
            'SELECT id FROM library_items WHERE user_id = ? AND category = ? AND external_id = ?',
            [userId, category, extId]
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
          'INSERT INTO library_items (user_id, category, title, external_id, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [userId, category, item.title, extId, thumb, metadata, 'simkl']
        );
        counts[category]++;
      }
    }
  }

  await db.run(
    'INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)',
    [userId, 'simkl_last_activities', JSON.stringify({ all: currentAll })]
  );

  return counts;
}

module.exports = { getPin, pollPin, syncSimkl, simklQS, simklHeaders };
