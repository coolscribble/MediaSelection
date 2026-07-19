const { db } = require('../database');
const { cacheImage, titleSlug } = require('./imageCache');

const BASE = 'https://comicvine.gamespot.com/api';
const HEADERS = { 'User-Agent': 'MediaPicker/1.0' };

// ComicVine free tier: 200 requests/hour per API key
const REQUESTS_PER_HOUR = 200;
const HOUR_MS = 3600 * 1000;
const RATE_BUFFER = 5;
let _reqCount = 0;
let _windowStart = Date.now();

async function waitForRateLimit() {
  const now = Date.now();
  const elapsed = now - _windowStart;
  if (elapsed >= HOUR_MS) {
    _reqCount = 0;
    _windowStart = now;
  }
  if (_reqCount >= REQUESTS_PER_HOUR - RATE_BUFFER) {
    const waitMs = HOUR_MS - elapsed + 2000;
    console.log(`[ComicVine] Rate limit: ${_reqCount} requests used. Pausing ${Math.round(waitMs / 1000)}s for window reset...`);
    await new Promise(r => setTimeout(r, waitMs));
    _reqCount = 0;
    _windowStart = Date.now();
  }
  _reqCount++;
}

async function getApiKey(userId) {
  const row = await db.get(
    'SELECT value FROM settings WHERE user_id = ? AND key = ?',
    [userId, 'comicvine_api_key']
  );
  if (!row?.value) throw new Error('ComicVine API key not configured in Settings');
  return row.value;
}

function parseComicTitle(title) {
  const volMatch  = title.match(/\(Vol\.?\s*(\d+)\)/i);
  const yearMatch = title.match(/\((\d{4})\s*[-–]\s*(\d{4}|Present)\)/i);
  const singleYearMatch = !yearMatch && title.match(/\((\d{4})\)/);

  const baseName = title
    .replace(/\s*\(Vol\.?\s*\d+\)/gi, '')
    .replace(/\s*\(\d{4}\s*[-–]\s*(?:\d{4}|Present)\)/gi, '')
    .replace(/\s*\(\d{4}\)/g, '')
    .trim();

  return {
    baseName: baseName || title,
    volume: volMatch ? parseInt(volMatch[1]) : null,
    startYear: yearMatch
      ? parseInt(yearMatch[1])
      : singleYearMatch ? parseInt(singleYearMatch[1]) : null,
  };
}

function buildCoverUrl(image) {
  return image?.medium_url || image?.original_url || image?.small_url || null;
}

async function searchVolume(title, apiKey) {
  const { baseName, startYear } = parseComicTitle(title);
  const q = encodeURIComponent(baseName);
  const url = `${BASE}/search/?api_key=${apiKey}&query=${q}&resources=volume&format=json&field_list=id,name,image,start_year,count_of_issues&limit=10`;
  await waitForRateLimit();
  const r = await fetch(url, { headers: HEADERS });
  if (r.status === 401 || r.status === 403) throw new Error('ComicVine API key is invalid — please re-enter it in Settings');
  if (!r.ok) return { result: null, confident: false, candidates: [] };
  const data = await r.json();
  if (data.status_code === 100 || data.status_code === 101) throw new Error('ComicVine API key is invalid — please re-enter it in Settings');
  if (data.status_code !== 1) return { result: null, confident: false, candidates: [] };

  const results = data.results || [];
  const nameLow = baseName.toLowerCase();
  const nameMatches = results.filter(x => x.name?.toLowerCase() === nameLow);
  const pool = nameMatches.length > 0 ? nameMatches : results;

  if (pool.length === 0) return { result: null, confident: false, candidates: [] };
  if (pool.length === 1) return { result: pool[0], confident: true, candidates: [] };

  if (startYear) {
    const yearHit = pool.find(x => x.start_year && Math.abs(parseInt(x.start_year) - startYear) <= 1);
    if (yearHit) return { result: yearHit, confident: true, candidates: [] };
  }

  const candidates = pool.slice(0, 5).map(x => ({
    id: x.id,
    name: x.name,
    start_year: x.start_year || null,
    thumb: buildCoverUrl(x.image),
  }));
  return { result: pool[0], confident: false, candidates };
}

async function lookupById(cvId, apiKey) {
  const url = `${BASE}/volume/4050-${cvId}/?api_key=${apiKey}&format=json&field_list=id,name,image,start_year`;
  await waitForRateLimit();
  const r = await fetch(url, { headers: HEADERS });
  if (r.status === 401 || r.status === 403) throw new Error('ComicVine API key is invalid — please re-enter it in Settings');
  if (!r.ok) return null;
  const data = await r.json();
  if (data.status_code === 100 || data.status_code === 101) throw new Error('ComicVine API key is invalid — please re-enter it in Settings');
  if (data.status_code !== 1) return null;
  return data.results || null;
}

async function syncComicVine({ userId, itemId } = {}) {
  const apiKey = await getApiKey(userId);

  const query = itemId
    ? "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE user_id = ? AND category = 'comics' AND id = ?"
    : "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE user_id = ? AND category = 'comics' AND (thumbnail_url IS NULL OR thumbnail_url = '')";
  const comics = itemId
    ? await db.all(query, [userId, itemId])
    : await db.all(query, [userId]);

  let updated = 0, skipped = 0, needsReview = 0;
  for (const comic of comics) {
    const meta = JSON.parse(comic.metadata || '{}');

    let result = null, confident = false, candidates = [];

    if (comic.external_id && !itemId) {
      result = await lookupById(comic.external_id, apiKey);
      confident = !!result;
    }
    if (!result) {
      ({ result, confident, candidates } = await searchVolume(comic.title, apiKey));
    }
    if (!result) { skipped++; continue; }

    const thumb = buildCoverUrl(result.image);
    const localThumb = thumb ? await cacheImage('comics', titleSlug(comic.title), thumb) : thumb;

    const merged = { ...meta, comicvine_id: result.id };
    if (!confident) {
      merged.cv_needs_review = true;
      merged.cv_candidates = candidates;
      needsReview++;
    } else {
      delete merged.cv_needs_review;
      delete merged.cv_candidates;
    }

    await db.run(
      'UPDATE library_items SET thumbnail_url = ?, metadata = ?, external_id = ? WHERE id = ?',
      [localThumb ?? comic.thumbnail_url, JSON.stringify(merged), String(result.id), comic.id]
    );
    updated++;
  }

  return { updated, skipped, needsReview };
}

module.exports = { syncComicVine };
