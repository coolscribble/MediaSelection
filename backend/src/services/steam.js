const { db } = require('../database');

async function resolveSteamId(apiKey, input) {
  const clean = input.trim();
  if (/^7656\d{13}$/.test(clean)) return clean;
  const vanity = clean.replace(/^https?:\/\/steamcommunity\.com\/id\//, '').replace(/\/$/, '');
  const r = await fetch(
    `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}`
  );
  const d = await r.json();
  if (d?.response?.success === 1) return d.response.steamid;
  throw new Error(`Could not find Steam account "${input}". Use your 64-bit Steam ID or exact vanity URL.`);
}

async function importSteamGames({ userId, steamId, apiKey }) {
  const id64 = await resolveSteamId(apiKey, steamId);
  const r = await fetch(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${id64}&include_appinfo=1&include_played_free_games=0&format=json`
  );
  if (r.status === 401 || r.status === 403) throw new Error('Invalid Steam API key.');
  if (!r.ok) throw new Error(`Steam API error ${r.status}`);
  const data = await r.json();
  const games = data?.response?.games ?? [];
  if (!games.length) throw new Error('No games found. Set Game Details to Public in Steam → Privacy Settings.');

  let added = 0, already = 0;
  for (const g of games) {
    const name = g.name?.trim();
    if (!name) continue;
    const extId = String(g.appid);
    const dup = await db.get(
      "SELECT id FROM library_items WHERE user_id = ? AND category = 'games' AND (external_id = ? OR LOWER(title) = LOWER(?))",
      [userId, extId, name]
    );
    if (dup) { already++; continue; }
    const cover = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_600x900_2x.jpg`;
    await db.run(
      'INSERT INTO library_items (user_id, category, title, thumbnail_url, external_id, metadata, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, 'games', name, cover, extId,
        JSON.stringify({ platform: 'PC (Steam)', playtime_hours: Math.round((g.playtime_forever ?? 0) / 60), appid: g.appid }),
        'steam']
    );
    added++;
  }
  return { added, already, total: games.length };
}

module.exports = { importSteamGames };
