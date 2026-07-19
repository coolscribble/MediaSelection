const { db } = require('../database');
const { cacheImage } = require('./imageCache');

// iTunes Search API — no API key required
const ITUNES_SEARCH = 'https://itunes.apple.com/search';
// Deezer Search API — no API key required, used as fallback when iTunes finds nothing
const DEEZER_SEARCH = 'https://api.deezer.com/search/album';

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

async function searchDeezer(artist, title) {
  const q = encodeURIComponent(`${artist} ${title}`.trim());
  const r = await fetch(`${DEEZER_SEARCH}?q=${q}&limit=5`, {
    headers: { 'User-Agent': 'MediaPicker/1.0' },
  });
  if (!r.ok) return null;
  const data = await r.json();
  return (data.data || [])[0] || null;
}

async function searchMusicBrainz(artist, title) {
  try {
    const terms = [
      artist ? `artist:"${artist.replace(/"/g, '')}"` : '',
      `release:"${title.replace(/"/g, '')}"`,
    ].filter(Boolean).join(' AND ');
    const r = await fetch(
      `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(terms)}&fmt=json&limit=5`,
      { headers: { 'User-Agent': 'MediaPicker/1.0 (github.com/coolscribble/MediaSelection)' } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const rgs = data['release-groups'] || [];
    return (rgs.find(g => g['primary-type'] === 'Album') || rgs[0]) || null;
  } catch { return null; }
}

async function getMBCoverUrl(mbid) {
  try {
    const r = await fetch(`https://coverartarchive.org/release-group/${mbid}/front`, {
      headers: { 'User-Agent': 'MediaPicker/1.0' },
    });
    if (!r.ok) return null;
    // CAA redirects to the actual image; r.url is the final URL after redirect
    return r.url || null;
  } catch { return null; }
}

async function syncAOTY() {
  const albums = await db.all(
    "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE category = 'albums'"
  );

  let updated = 0, skipped = 0;
  for (const album of albums) {
    const meta = JSON.parse(album.metadata || '{}');
    const artist = meta.artist || meta.Artist || '';

    let result = await searchITunes(artist, album.title);
    let thumb = null;
    let merged = { ...meta };

    if (result) {
      thumb = buildCoverUrl(result.artworkUrl100);
      merged = {
        ...meta,
        itunes_id: result.collectionId,
        artist:    result.artistName  ?? meta.artist,
        year:      result.releaseDate ? result.releaseDate.slice(0, 4) : meta.year,
        genre:     result.primaryGenreName ?? meta.genre,
      };
    }

    // Deezer fallback — better coverage for non-English or independent albums
    if (!thumb) {
      const dz = await searchDeezer(artist, album.title);
      if (dz) {
        thumb = dz.cover_xl || dz.cover_big || null;
        merged = {
          ...meta,
          deezer_id: dz.id,
          artist:    dz.artist?.name ?? meta.artist,
        };
      }
    }

    // MusicBrainz + Cover Art Archive as final fallback
    if (!thumb) {
      const mbResult = await searchMusicBrainz(artist, album.title);
      if (mbResult?.id) {
        await new Promise(res => setTimeout(res, 1000)); // MusicBrainz rate limit: 1 req/s
        thumb = await getMBCoverUrl(mbResult.id);
        if (thumb) {
          merged = { ...meta, mb_id: mbResult.id, artist: mbResult['artist-credit']?.[0]?.name ?? meta.artist };
        }
      }
    }

    if (!thumb) { skipped++; continue; }

    const localThumb = await cacheImage(String(album.id), thumb ?? album.thumbnail_url);
    const extId = result ? String(result.collectionId) : (merged.deezer_id ? String(merged.deezer_id) : album.external_id);
    await db.run(
      'UPDATE library_items SET thumbnail_url = ?, metadata = ?, external_id = ? WHERE id = ?',
      [localThumb, JSON.stringify(merged), extId, album.id]
    );
    updated++;

    await new Promise(res => setTimeout(res, 200));
  }

  return { updated, skipped };
}

module.exports = { syncAOTY };
