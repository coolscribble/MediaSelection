'use strict';
const { db } = require('../database');

const EMBY_CLIENT = 'MediaBrowser Client="MediaPicker", Device="Browser", DeviceId="mediapicker-web", Version="1.0.0"';

function jellyfinHeaders(token) {
  const auth = `${EMBY_CLIENT}, Token="${token}"`;
  return {
    Authorization:          auth,
    'X-Emby-Authorization': auth,
    'Content-Type':         'application/json',
  };
}

async function _fetchItems(serverUrl, jellyfinId, token, { isPlayed = null } = {}) {
  const params = new URLSearchParams({
    Recursive:        'true',
    IncludeItemTypes: 'Movie,Series',
    Fields:           'ProviderIds,ProductionLocations,Genres,ImageTags',
    Limit:            '10000',
  });
  if (isPlayed !== null) params.set('IsPlayed', String(isPlayed));

  const url = `${serverUrl}/Users/${jellyfinId}/Items?${params}`;
  const r   = await fetch(url, { headers: jellyfinHeaders(token) });
  if (r.status === 401) throw new Error('Jellyfin token expired — please log out and back in.');
  if (!r.ok) throw new Error(`Jellyfin API error: ${r.status}`);
  return (await r.json()).Items || [];
}

/** Fetch all played (watched) items — used by worldmap. */
async function getWatchedItems(serverUrl, jellyfinId, token) {
  return _fetchItems(serverUrl, jellyfinId, token, { isPlayed: true });
}

/** Fetch every Movie + Series in the library (no play-state filter). */
async function getAllItems(serverUrl, jellyfinId, token) {
  return _fetchItems(serverUrl, jellyfinId, token, {});
}

/**
 * Import the full Jellyfin library (all movies + series) into library_items.
 * Movies → 'movies', Series with "Anime" genre → 'anime', other series → 'series'.
 * Deduplicates by Jellyfin item ID (jf:{id}) and by TMDB ID.
 */
async function importJellyfinLibrary(userId) {
  const userRow = await db.get(
    'SELECT server_url, jellyfin_id, jellyfin_token FROM users WHERE username = ?',
    [userId]
  );

  if (!userRow?.server_url) {
    throw new Error('This account is not linked to a Jellyfin server. Log in with Jellyfin credentials to use this import.');
  }
  if (!userRow?.jellyfin_token) {
    throw new Error('Jellyfin token missing — please log out and back in to refresh it.');
  }

  const items = await getAllItems(userRow.server_url, userRow.jellyfin_id, userRow.jellyfin_token);
  console.log(`[jellyfin/import] ${items.length} items`);

  const counts = { movies: 0, series: 0, anime: 0, already: 0 };

  for (const item of items) {
    if (item.Type !== 'Movie' && item.Type !== 'Series') continue;

    const genres  = item.Genres || [];
    const isAnime = genres.some(g => g.toLowerCase() === 'anime');

    const category =
      item.Type === 'Movie' ? 'movies'
      : isAnime             ? 'anime'
      :                       'series';

    const externalId = `jf:${item.Id}`;
    const tmdbRaw    = item.ProviderIds?.Tmdb || item.ProviderIds?.tmdb || null;
    const tmdbId     = tmdbRaw ? parseInt(tmdbRaw, 10) : null;

    // Dedup: by Jellyfin external_id
    const existing = await db.get(
      'SELECT id FROM library_items WHERE user_id = ? AND category = ? AND external_id = ?',
      [userId, category, externalId]
    );
    if (existing) { counts.already++; continue; }

    // Dedup: by TMDB ID (avoids duplicating items already imported from Simkl)
    if (tmdbId) {
      const tmdbMatch = await db.get(
        `SELECT id FROM library_items WHERE user_id = ? AND category = ?
         AND json_extract(metadata, '$.tmdb_id') = ?`,
        [userId, category, tmdbId]
      );
      if (tmdbMatch) { counts.already++; continue; }
    }

    // Thumbnail: Jellyfin image endpoint (no auth required for images by default)
    const thumbUrl = item.ImageTags?.Primary
      ? `${userRow.server_url}/Items/${item.Id}/Images/Primary?maxWidth=200&quality=90`
      : null;

    const metadata = JSON.stringify({
      year: item.ProductionYear || null,
      ...(tmdbId ? { tmdb_id: tmdbId } : {}),
    });

    await db.run(
      'INSERT INTO library_items (user_id, category, title, external_id, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, category, item.Name, externalId, thumbUrl, metadata, 'jellyfin']
    );
    counts[category]++;
  }

  console.log(`[jellyfin/import] done — movies:${counts.movies} series:${counts.series} anime:${counts.anime} already:${counts.already}`);
  return counts;
}

module.exports = { jellyfinHeaders, getWatchedItems, getAllItems, importJellyfinLibrary };
