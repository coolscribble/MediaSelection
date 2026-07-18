const { db } = require('../database');

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

async function searchIGDB(title, clientId, token) {
  const safe = title.replace(/"/g, '');
  const r = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-ID': clientId,
      'Content-Type': 'text/plain',
    },
    body: `fields name,cover.url,first_release_date,genres.name,platforms.name,total_rating; search "${safe}"; limit 1;`,
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.[0] || null;
}

async function syncIGDB() {
  const { clientId } = await getCredentials();
  const token = await getAccessToken();

  const games = await db.all(
    "SELECT id, title, thumbnail_url, metadata FROM library_items WHERE category = 'games'"
  );

  let updated = 0, skipped = 0;
  for (const game of games) {
    const result = await searchIGDB(game.title, clientId, token);
    if (!result) { skipped++; continue; }

    // Build cover URL — cover_big size, WebP format for smaller file size
    const rawUrl = result.cover?.url || null;
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

    await db.run(
      // Only set thumbnail if not already present (preserve manually uploaded covers)
      'UPDATE library_items SET thumbnail_url = COALESCE(thumbnail_url, ?), metadata = ?, external_id = COALESCE(external_id, ?) WHERE id = ?',
      [thumb, JSON.stringify(merged), String(result.id), game.id]
    );
    updated++;

    // 250 ms delay to stay within IGDB rate limits
    await new Promise(res => setTimeout(res, 250));
  }

  return { updated, skipped };
}

module.exports = { syncIGDB };
