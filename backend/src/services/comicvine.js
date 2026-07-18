const { db } = require('../database');

const BASE = 'https://comicvine.gamespot.com/api';
const HEADERS = { 'User-Agent': 'MediaPicker/1.0' };

async function getApiKey() {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', ['comicvine_api_key']);
  if (!row?.value) throw new Error('ComicVine API key not configured in Settings');
  return row.value;
}

// Search by series/volume title — returns best match or null
async function searchVolume(title, apiKey) {
  const q = encodeURIComponent(title);
  const url = `${BASE}/search/?api_key=${apiKey}&query=${q}&resources=volume&format=json&field_list=id,name,image&limit=5`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return null;
  const data = await r.json();
  if (data.status_code !== 1) return null;
  const results = data.results || [];
  const titleLow = title.toLowerCase();
  // Prefer exact name match
  return results.find(x => x.name?.toLowerCase() === titleLow) || results[0] || null;
}

// Direct lookup by ComicVine volume ID
async function lookupById(cvId, apiKey) {
  const url = `${BASE}/volume/4050-${cvId}/?api_key=${apiKey}&format=json&field_list=id,name,image`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return null;
  const data = await r.json();
  if (data.status_code !== 1) return null;
  return data.results || null;
}

function buildCoverUrl(image) {
  // medium_url is typically 800px wide — good quality without being excessive
  return image?.medium_url || image?.original_url || image?.small_url || null;
}

async function syncComicVine() {
  const apiKey = await getApiKey();

  const comics = await db.all(
    "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE category = 'comics'"
  );

  let updated = 0, skipped = 0;
  for (const comic of comics) {
    const meta = JSON.parse(comic.metadata || '{}');

    let result = null;
    if (comic.external_id) {
      result = await lookupById(comic.external_id, apiKey);
    }
    if (!result) {
      result = await searchVolume(comic.title, apiKey);
    }
    if (!result) { skipped++; continue; }

    const thumb = buildCoverUrl(result.image);
    const merged = { ...meta, comicvine_id: result.id };

    await db.run(
      'UPDATE library_items SET thumbnail_url = ?, metadata = ?, external_id = ? WHERE id = ?',
      [thumb ?? comic.thumbnail_url, JSON.stringify(merged), String(result.id), comic.id]
    );
    updated++;

    // ComicVine free tier: ~200 req/hour — 500ms keeps us well within limits
    await new Promise(res => setTimeout(res, 500));
  }

  return { updated, skipped };
}

module.exports = { syncComicVine };
