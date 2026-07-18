const { db } = require('../database');

const BASE = 'https://api.albumoftheyear.org/v1';

async function getApiKey() {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', ['aoty_api_key']);
  if (!row?.value) throw new Error('Album of the Year API key not configured in Settings');
  return row.value;
}

// Search AOTY for an album — returns the best match or null
async function searchAOTY(artist, title, apiKey) {
  const q = encodeURIComponent(`${artist} ${title}`.trim());
  const url = `${BASE}/search/?q=${q}&type=album&include=album&key=${apiKey}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();

  // API returns { albums: [ { albumID, artistName, albumName, art, ... } ] }
  const albums = data.albums || data.results?.albums || [];
  return albums[0] || null;
}

// Build a usable cover URL — AOTY serves images at //e.snmc.io/i/300/... so we bump to 600px
function buildCoverUrl(art) {
  if (!art) return null;
  return art
    .replace(/^\/\//, 'https://')
    .replace(/\/i\/\d+\//, '/i/600/');  // upgrade thumbnail size to 600px
}

async function syncAOTY() {
  const apiKey = await getApiKey();

  const albums = await db.all(
    "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE category = 'albums'"
  );

  let updated = 0, skipped = 0;
  for (const album of albums) {
    const meta = JSON.parse(album.metadata || '{}');
    const artist = meta.artist || meta.Artist || '';
    const title = album.title;

    let result = null;

    // If we already have an AOTY ID, fetch by ID for an exact lookup
    if (album.external_id) {
      const url = `${BASE}/album/${album.external_id}/?key=${apiKey}`;
      const r = await fetch(url);
      if (r.ok) result = await r.json();
    }

    // Fall back to search if no ID or ID lookup failed
    if (!result) {
      result = await searchAOTY(artist, title, apiKey);
    }

    if (!result) { skipped++; continue; }

    // Cover URL — try multiple field names the API may use
    const artUrl = result.art || result.artworkUrl || result.cover || result.image || null;
    const thumb = buildCoverUrl(artUrl);

    // Merge AOTY fields into existing metadata
    const aotyMeta = {
      aoty_id:  result.albumID || result.id,
      artist:   result.artistName || result.artist || meta.artist,
      ...(result.rating !== undefined && { rating: result.rating }),
      ...(result.year   !== undefined && { year:   result.year }),
      ...(result.genres?.length       && { genres: result.genres.map(g => g.name || g) }),
    };
    const merged = { ...meta, ...aotyMeta };

    await db.run(
      'UPDATE library_items SET thumbnail_url = ?, metadata = ?, external_id = ? WHERE id = ?',
      [thumb ?? album.thumbnail_url, JSON.stringify(merged), String(aotyMeta.aoty_id || album.external_id || ''), album.id]
    );
    updated++;

    // Stay within AOTY rate limits
    await new Promise(res => setTimeout(res, 300));
  }

  return { updated, skipped };
}

module.exports = { syncAOTY };
