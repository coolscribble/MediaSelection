const { db } = require('../database');

async function importXboxGames({ userId, gamertag, apiKey }) {
  const tag = gamertag.trim();
  const r = await fetch(
    `https://xbl.io/api/v2/player/titleHistory?gamertag=${encodeURIComponent(tag)}`,
    { headers: { 'X-Authorization': apiKey.trim(), 'Accept': 'application/json', 'X-Contract': '107' } }
  );
  if (r.status === 401) throw new Error('Invalid xbl.io API key. Get a free key at xbl.io.');
  if (r.status === 404) throw new Error(`Gamertag "${tag}" not found.`);
  if (!r.ok) throw new Error(`xbl.io API error ${r.status}`);
  const data = await r.json();

  const titles = (data?.titles ?? []).filter(t =>
    !t.mediaItemType || t.mediaItemType === 'Game' || t.mediaItemType === 'GamePass'
  );

  let added = 0, already = 0;
  for (const t of titles) {
    const name = t.name?.trim();
    if (!name) continue;
    const extId = t.titleId ? String(t.titleId) : null;
    const dup = await db.get(
      "SELECT id FROM library_items WHERE user_id = ? AND category = 'games' AND (external_id = ? OR LOWER(title) = LOWER(?))",
      [userId, extId ?? '', name]
    );
    if (dup) { already++; continue; }
    const devices = Array.isArray(t.devices) ? t.devices.join(', ') : (t.devices ?? 'Xbox');
    await db.run(
      'INSERT INTO library_items (user_id, category, title, thumbnail_url, external_id, metadata, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, 'games', name, t.displayImage || null, extId,
        JSON.stringify({ platform: `Xbox (${devices})`, titleId: t.titleId }),
        'xbox']
    );
    added++;
  }
  return { added, already, total: titles.length };
}

module.exports = { importXboxGames };
