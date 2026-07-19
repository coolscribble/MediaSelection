const { db } = require('../database');
const { cacheImage } = require('./imageCache');

// In-memory token cache — refreshed when expired
let cachedToken = null;
let tokenExpiry = 0;

async function getCredentials() {
  const [cidRow, secretRow] = await Promise.all([
    db.get('SELECT value FROM settings WHERE key = ?', ['igdb_client_id']),
    db.get('SELECT value FROM settings WHERE key = ?', ['igdb_client_secret']),
  ]);
  if (!cidRow?.value || !secretRow?.value) throw new Error('IGDB credentials not configured in Settings');
  return { clientId: cidRow.value, clientSecret: secretRow.value };
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const { clientId, clientSecret } = await getCredentials();
  const r = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  if (!r.ok) throw new Error(`Twitch OAuth failed (${r.status}) — check IGDB credentials`);
  const data = await r.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
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

// Exact ID lookup — used when the CSV already contains an IGDB ID
async function lookupById(igdbId, clientId, token) {
  return igdbRequest(`${IGDB_FIELDS} where id = ${igdbId}; limit 1;`, clientId, token);
}

// Title search — fallback when no IGDB ID is stored
async function searchByTitle(title, clientId, token) {
  const safe = title.replace(/"/g, '');
  return igdbRequest(`${IGDB_FIELDS} search "${safe}"; limit 1;`, clientId, token);
}

async function syncIGDB({ itemId } = {}) {
  const { clientId } = await getCredentials();
  const token = await getAccessToken();

  const query = itemId
    ? "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE category = 'games' AND id = ?"
    : "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE category = 'games'";
  const games = itemId ? await db.all(query, [itemId]) : await db.all(query);

  let updated = 0, skipped = 0, deleted = 0;
  for (const game of games) {
    // Prefer the IGDB ID from the CSV (exact match); fall back to title search
    const result = game.external_id
      ? await lookupById(game.external_id, clientId, token)
      : await searchByTitle(game.title, clientId, token);
    if (!result) { skipped++; continue; }

    // Remove DLC (1) and expansions (2) from the library — they should not be tracked separately
    if (result.category === 1 || result.category === 2) {
      await db.run('UPDATE slots SET item_id = NULL, is_locked = 0 WHERE item_id = ?', [game.id]);
      await db.run('DELETE FROM library_items WHERE id = ?', [game.id]);
      deleted++;
      continue;
    }

    // Build cover URL — cover_big size, WebP format for smaller file size
    const rawUrl = result.cover?.url || result.version_parent?.cover?.url || null;
    const thumb = rawUrl
      ? rawUrl
          .replace('t_thumb', 't_cover_big')
          .replace(/^\/\//, 'https://')
          .replace(/\.jpg$/, '.webp')
      : null;

    // Merge new IGDB fields into existing metadata so CSV fields are preserved
    const existingMeta = JSON.parse(game.metadata || '{}');
    const igdbMeta = {
      igdb_id: result.id,
      ...(result.total_rating !== undefined && { rating: Math.round(result.total_rating) }),
      ...(result.first_release_date && {
        releaseDate: new Date(result.first_release_date * 1000).toISOString().split('T')[0],
      }),
      ...(result.genres?.length && { genres: result.genres.map(g => g.name) }),
      ...(result.platforms?.length && { platforms: result.platforms.map(p => p.name) }),
    };
    const merged = { ...existingMeta, ...igdbMeta };

    const localThumb = await cacheImage(String(game.id), thumb ?? game.thumbnail_url);
    await db.run(
      'UPDATE library_items SET thumbnail_url = ?, metadata = ?, external_id = ? WHERE id = ?',
      [localThumb, JSON.stringify(merged), String(result.id), game.id]
    );
    updated++;

    // 250 ms delay to stay within IGDB rate limits
    await new Promise(res => setTimeout(res, 250));
  }

  return { updated, skipped, deleted };
}

module.exports = { syncIGDB };
