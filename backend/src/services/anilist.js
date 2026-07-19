const { db } = require('../database');
const { cacheImage } = require('./imageCache');

const ANILIST_API = 'https://graphql.anilist.co';

const LIST_QUERY = `
query ($userName: String, $type: MediaType, $status: MediaListStatus) {
  MediaListCollection(userName: $userName, type: $type, status: $status) {
    lists { entries { media {
      id title { romaji english } coverImage { extraLarge large } format
      episodes chapters status
    }}}
  }
}`;

const AIRING_QUERY = `
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id episodes status
      nextAiringEpisode { airingAt episode }
    }
  }
}`;

async function syncAniList() {
  const userRow = await db.get('SELECT value FROM settings WHERE key = ?', ['anilist_username']);
  if (!userRow?.value) throw new Error('AniList username is not configured');

  const statesRow = await db.get('SELECT value FROM settings WHERE key = ?', ['anilist_states']);
  const states = statesRow?.value ? JSON.parse(statesRow.value) : ['PLANNING'];

  let animeCount = 0, mangaCount = 0;

  for (const type of ['ANIME', 'MANGA']) {
    for (const status of states) {
      const res = await fetch(ANILIST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: LIST_QUERY, variables: { userName: userRow.value, type, status } }),
      });
      if (!res.ok) throw new Error(`AniList API error: ${res.status}`);
      const json = await res.json();
      if (json.errors) throw new Error(json.errors[0].message);

      const entries = (json.data?.MediaListCollection?.lists || []).flatMap(l => l.entries);
      const category = type === 'ANIME' ? 'anime' : 'manga';

      for (const e of entries) {
        const m = e.media;
        const total = type === 'ANIME' ? (m.episodes || null) : (m.chapters || null);
        const storedTitle = m.title.english || m.title.romaji
        const romajiAlt = m.title.romaji && m.title.romaji !== storedTitle ? m.title.romaji : null
        const metadata = JSON.stringify({ format: m.format, status: m.status, total, ...(romajiAlt ? { romaji_title: romajiAlt } : {}) })

        const remoteThumb = m.coverImage?.extraLarge || m.coverImage?.large || null;
        const localThumb = remoteThumb
          ? await cacheImage(category, `anilist_${m.id}`, remoteThumb)
          : null;

        const existing = await db.get(
          'SELECT id FROM library_items WHERE category = ? AND external_id = ?',
          [category, String(m.id)]
        );
        if (existing) {
          await db.run(
            'UPDATE library_items SET thumbnail_url = ?, metadata = ? WHERE id = ?',
            [localThumb, metadata, existing.id]
          );
        } else {
          await db.run(
            'INSERT INTO library_items (category, title, external_id, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?, ?)',
            [category, m.title.english || m.title.romaji, String(m.id), localThumb, metadata, 'anilist']
          );
          type === 'ANIME' ? animeCount++ : mangaCount++;
        }
      }
    }
  }

  return { anime: animeCount, manga: mangaCount };
}

// Refreshes nextAiringEpisode data for all ongoing anime items
async function updateOngoingAiringInfo() {
  const items = await db.all(
    "SELECT id, external_id FROM ongoing_items WHERE source = 'anilist' AND external_id IS NOT NULL"
  );
  if (!items.length) return { updated: 0 };

  let updated = 0;
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const ids = batch.map(r => Number(r.external_id)).filter(n => !isNaN(n));
    if (!ids.length) continue;

    const res = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: AIRING_QUERY, variables: { ids } }),
    });
    if (!res.ok) continue;
    const json = await res.json();
    if (json.errors) continue;

    for (const m of (json.data?.Page?.media || [])) {
      let airingInfo = null;
      if (m.nextAiringEpisode) {
        airingInfo = JSON.stringify({
          episodes_aired: m.nextAiringEpisode.episode - 1,
          total_episodes: m.episodes || null,
          next_episode: m.nextAiringEpisode.episode,
          next_air_time: m.nextAiringEpisode.airingAt * 1000,
        });
      } else if (m.status === 'FINISHED' && m.episodes) {
        airingInfo = JSON.stringify({
          episodes_aired: m.episodes,
          total_episodes: m.episodes,
          next_episode: null,
          next_air_time: null,
        });
      }
      if (airingInfo !== null) {
        await db.run(
          "UPDATE ongoing_items SET airing_info = ? WHERE source = 'anilist' AND external_id = ?",
          [airingInfo, String(m.id)]
        );
        updated++;
      }
    }
  }
  return { updated };
}

module.exports = { syncAniList, updateOngoingAiringInfo };
