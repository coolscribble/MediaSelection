const { db } = require('../database');
const { cacheImage } = require('./imageCache');

// Per-user token cache keyed by userId
const tokenCache = new Map();

async function getCredentials(userId) {
  const [cidRow, secretRow] = await Promise.all([
    db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'igdb_client_id']),
    db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'igdb_client_secret']),
  ]);
  if (!cidRow?.value || !secretRow?.value) throw new Error('IGDB credentials not configured in Settings');
  return { clientId: cidRow.value, clientSecret: secretRow.value };
}

async function getAccessToken(userId) {
  const cached = tokenCache.get(userId);
  if (cached && Date.now() < cached.expiry) return cached.token;
  const { clientId, clientSecret } = await getCredentials(userId);
  const r = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  if (!r.ok) throw new Error(`Twitch OAuth failed (${r.status}) — check IGDB credentials`);
  const data = await r.json();
  tokenCache.set(userId, { token: data.access_token, expiry: Date.now() + (data.expires_in - 60) * 1000 });
  return data.access_token;
}

const IGDB_FIELDS = 'fields name,cover.url,version_parent.cover.url,category,first_release_date,genres.name,platforms.name,total_rating;';

async function igdbRequest(body, clientId, token) {
  const r = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-ID': clientId,
      'Content-Type': 'text/plain',
    },
    body,
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.[0] || null;
}

async function lookupById(igdbId, clientId, token) {
  return igdbRequest(`${IGDB_FIELDS} where id = ${igdbId}; limit 1;`, clientId, token);
}

async function searchByTitle(title, clientId, token) {
  const safe = title.replace(/"/g, '');
  return igdbRequest(`${IGDB_FIELDS} search "${safe}"; limit 1;`, clientId, token);
}

async function syncIGDB({ userId, itemId } = {}) {
  const { clientId } = await getCredentials(userId);
  const token = await getAccessToken(userId);

  const query = itemId
    ? "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE user_id = ? AND category = 'games' AND id = ?"
    : "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE user_id = ? AND category = 'games'";
  const games = itemId
    ? await db.all(query, [userId, itemId])
    : await db.all(query, [userId]);

  let updated = 0, skipped = 0, dlcFound = 0;
  for (const game of games) {
    let result = game.external_id
      ? await lookupById(game.external_id, clientId, token)
      : await searchByTitle(game.title, clientId, token);

    if (!result) { skipped++; await new Promise(r => setTimeout(r, 250)); continue; }

    if (result.category === 1 || result.category === 2) {
      const existingMeta = JSON.parse(game.metadata || '{}');
      await db.run('UPDATE library_items SET metadata = ? WHERE id = ?', [
        JSON.stringify({ ...existingMeta, is_dlc: true, igdb_category: result.category }),
        game.id,
      ]);
      dlcFound++;
      await new Promise(r => setTimeout(r, 250));
      continue;
    }

    const rawUrl = result.cover?.url || result.version_parent?.cover?.url || null;

    if (!rawUrl && game.external_id) {
      const byTitle = await searchByTitle(game.title, clientId, token);
      if (byTitle && (byTitle.cover?.url || byTitle.version_parent?.cover?.url)) {
        result = byTitle;
      }
      await new Promise(r => setTimeout(r, 250));
    }

    const finalRaw = result.cover?.url || result.version_parent?.cover?.url || null;
    const thumb = finalRaw
      ? finalRaw
          .replace('t_thumb', 't_cover_big')
          .replace(/^\/\//, 'https://')
          .replace(/\.jpg$/, '.webp')
      : null;

    const existingMeta = JSON.parse(game.metadata || '{}');
    const igdbMeta = {
      igdb_id: result.id,
      ...(result.category && result.category !== 0 && { igdb_category: result.category }),
      ...(result.total_rating !== undefined && { rating: Math.round(result.total_rating) }),
      ...(result.first_release_date && {
        releaseDate: new Date(result.first_release_date * 1000).toISOString().split('T')[0],
      }),
      ...(result.genres?.length && { genres: result.genres.map(g => g.name) }),
      ...(result.platforms?.length && { platforms: result.platforms.map(p => p.name) }),
    };
    const merged = { ...existingMeta, ...igdbMeta };

    if (thumb) {
      const localThumb = await cacheImage('games', `igdb_${result.id}`, thumb, userId);
      await db.run(
        'UPDATE library_items SET thumbnail_url = ?, metadata = ?, external_id = ? WHERE id = ?',
        [localThumb, JSON.stringify(merged), String(result.id), game.id]
      );
      updated++;
    } else {
      await db.run(
        'UPDATE library_items SET metadata = ?, external_id = ? WHERE id = ?',
        [JSON.stringify(merged), String(result.id), game.id]
      );
      skipped++;
    }

    await new Promise(r => setTimeout(r, 250));
  }

  return { updated, skipped, dlcFound };
}

module.exports = { syncIGDB };
