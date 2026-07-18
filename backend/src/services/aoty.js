const { db } = require('../database');

// iTunes Search API — no API key required
const ITUNES_SEARCH = 'https://itunes.apple.com/search';

async function searchITunes(artist, title) {
  const q = encodeURIComponent(`${artist} ${title}`.trim());
  const r = await fetch(`${ITUNES_SEARCH}?term=${q}&media=music&entity=album&limit=10`, {
    headers: { 'User-Agent': 'MediaPicker/1.0' },
  });
  if (!r.ok) return null;
  const data = await r.json();
  const results = (data.results || []).filter(x => x.wrapperType === 'collection');
  if (!results.length) return null;

  // Prefer an exact album-name match; fall back to first result
  const titleLow = title.toLowerCase();
  const artistLow = artist.toLowerCase();
  return (
    results.find(
      x =>
        x.collectionName?.toLowerCase() === titleLow &&
        x.artistName?.toLowerCase().includes(artistLow)
    ) || results[0]
  );
}

function buildCoverUrl(url100) {
  if (!url100) return null;
  // Upgrade Apple's thumbnail to 600×600 (also available: 1000x1000bb)
  return url100.replace('100x100bb', '600x600bb');
}

async function syncAOTY() {
  const albums = await db.all(
    "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE category = 'albums'"
  );

  let updated = 0, skipped = 0;
  for (const album of albums) {
    const meta = JSON.parse(album.metadata || '{}');
    const artist = meta.artist || meta.Artist || '';

    const result = await searchITunes(artist, album.title);
    if (!result) { skipped++; continue; }

    const thumb = buildCoverUrl(result.artworkUrl100);
    const merged = {
      ...meta,
      itunes_id: result.collectionId,
      artist:    result.artistName  ?? meta.artist,
      year:      result.releaseDate ? result.releaseDate.slice(0, 4) : meta.year,
      genre:     result.primaryGenreName ?? meta.genre,
    };

    await db.run(
      'UPDATE library_items SET thumbnail_url = ?, metadata = ?, external_id = ? WHERE id = ?',
      [thumb ?? album.thumbnail_url, JSON.stringify(merged), String(result.collectionId), album.id]
    );
    updated++;

    await new Promise(res => setTimeout(res, 200));
  }

  return { updated, skipped };
}

module.exports = { syncAOTY };
