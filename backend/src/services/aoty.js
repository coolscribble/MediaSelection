const { db } = require('../database');
const { cacheImage, titleSlug } = require('./imageCache');

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
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
    return r.url || null;
  } catch { return null; }
}

async function syncAOTY({ userId, itemId } = {}) {
  const query = itemId
    ? "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE user_id = ? AND category = 'albums' AND id = ?"
    : "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE user_id = ? AND category = 'albums'";
  const albums = itemId
    ? await db.all(query, [userId, itemId])
    : await db.all(query, [userId]);

  let updated = 0, skipped = 0;
  for (const album of albums) {
    const meta = JSON.parse(album.metadata || '{}');
    const artist = meta.artist || meta.Artist || '';

    let thumb = null;
    let stableKey = null;
    let merged = { ...meta };

    const mbResult = await searchMusicBrainz(artist, album.title);
    if (mbResult?.id) {
      await new Promise(res => setTimeout(res, 1000));
      thumb = await getMBCoverUrl(mbResult.id);
      if (thumb) {
        stableKey = `mb_${mbResult.id}`;
        merged = { ...meta, mb_id: mbResult.id, artist: mbResult['artist-credit']?.[0]?.name ?? meta.artist };
      }
    }

    if (!thumb) {
      const dz = await searchDeezer(artist, album.title);
      if (dz) {
        thumb = dz.cover_xl || dz.cover_big || null;
        if (thumb) {
          stableKey = `dz_${dz.id}`;
          merged = { ...meta, deezer_id: dz.id, artist: dz.artist?.name ?? meta.artist };
        }
      }
    }

    if (!thumb) {
      const result = await searchITunes(artist, album.title);
      if (result) {
        thumb = buildCoverUrl(result.artworkUrl100);
        if (thumb) {
          stableKey = `it_${result.collectionId}`;
          merged = {
            ...meta,
            itunes_id: result.collectionId,
            artist:    result.artistName  ?? meta.artist,
            year:      result.releaseDate ? result.releaseDate.slice(0, 4) : meta.year,
            genre:     result.primaryGenreName ?? meta.genre,
          };
        }
      }
    }

    if (!thumb || !stableKey) stableKey = `album_${titleSlug(album.title)}`;
    if (!thumb) { skipped++; continue; }

    const localThumb = await cacheImage('albums', stableKey, thumb);
    const extId = merged.itunes_id ? String(merged.itunes_id)
      : merged.deezer_id ? String(merged.deezer_id)
      : merged.mb_id ? String(merged.mb_id)
      : album.external_id;

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
