const { db } = require('../database');

const STEAM_API = 'https://api.steampowered.com';

async function resolveSteamId64(input, apiKey) {
  const s = input.trim().replace(/\/$/, '');
  if (/^7656\d{13}$/.test(s)) return s;
  const urlNumeric = s.match(/\/profiles\/(7656\d{13})/);
  if (urlNumeric) return urlNumeric[1];
  let vanity = s;
  const vanityMatch = s.match(/\/id\/([^/?]+)/);
  if (vanityMatch) vanity = vanityMatch[1];
  const r = await fetch(
    `${STEAM_API}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}`,
    { headers: { 'User-Agent': 'mediapicker/1.0' } }
  );
  if (!r.ok) throw new Error(`Steam API error ${r.status}`);
  const json = await r.json();
  if (json.response?.success === 1) return json.response.steamid;
  throw new Error(`Could not find Steam profile for "${vanity}". Check your username.`);
}

async function importSteamGames({ userId, steamId, apiKey }) {
  const steamId64 = await resolveSteamId64(steamId, apiKey);

  const url = `${STEAM_API}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId64}&include_appinfo=1&include_played_free_games=1&format=json`;
  const r = await fetch(url, { headers: { 'User-Agent': 'mediapicker/1.0' } });
  if (!r.ok) throw new Error(`Steam API error ${r.status}`);
  const json = await r.json();

  const games = json.response?.games;
  if (!games?.length) {
    throw new Error('No games returned. If your Game Details are set to Private in Steam → Privacy Settings, set them to Public and try again.');
  }

  let added = 0, already = 0;
  for (const g of games) {
    const extId = String(g.appid);
    const dup = await db.get(
      "SELECT id FROM library_items WHERE user_id = ? AND category = 'games' AND (external_id = ? OR LOWER(title) = LOWER(?))",
      [userId, extId, g.name]
    );
    if (dup) { already++; continue; }
    const cover = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_600x900_2x.jpg`;
    const playtimeHours = Math.round((g.playtime_forever || 0) / 60);
    await db.run(
      'INSERT INTO library_items (user_id, category, title, thumbnail_url, external_id, metadata, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, 'games', g.name, cover, extId,
        JSON.stringify({ platform: 'PC (Steam)', playtime_hours: playtimeHours, appid: g.appid }),
        'steam']
    );
    added++;
  }
  return { added, already, total: games.length };
}

module.exports = { importSteamGames };
