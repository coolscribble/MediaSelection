'use strict';

const EMBY_CLIENT = 'MediaBrowser Client="MediaPicker", Device="Browser", DeviceId="mediapicker-web", Version="1.0.0"';

function jellyfinHeaders(token) {
  const auth = `${EMBY_CLIENT}, Token="${token}"`;
  return {
    Authorization: auth,
    'X-Emby-Authorization': auth,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch all played (watched) movies and TV series from a Jellyfin user library.
 * Returns an array of items, each with at least { Id, Name, Type, ProviderIds }.
 */
async function getWatchedItems(serverUrl, jellyfinId, token) {
  const params = new URLSearchParams({
    Recursive:        'true',
    IsPlayed:         'true',
    IncludeItemTypes: 'Movie,Series',
    Fields:           'ProviderIds,ProductionLocations,Genres',
    Limit:            '10000',
  });

  const url = `${serverUrl}/Users/${jellyfinId}/Items?${params}`;
  const r   = await fetch(url, { headers: jellyfinHeaders(token) });

  if (r.status === 401) throw new Error('Jellyfin token expired — please log out and back in.');
  if (!r.ok) throw new Error(`Jellyfin API error: ${r.status}`);

  const data = await r.json();
  return data.Items || [];
}

module.exports = { jellyfinHeaders, getWatchedItems };
