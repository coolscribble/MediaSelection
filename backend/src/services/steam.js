const { db } = require('../database');

function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"');
}

function parseGamesXml(xml) {
  if (xml.includes('<error>')) {
    const msg = xml.match(/<error>(.*?)<\/error>/)?.[1] || 'Profile not found or private';
    throw new Error(`Steam: ${decodeXmlEntities(msg)}`);
  }
  const games = [];
  for (const block of (xml.match(/<game>[\s\S]*?<\/game>/g) || [])) {
    const appID = block.match(/<appID>(\d+)<\/appID>/)?.[1];
    const name  = block.match(/<name>(.*?)<\/name>/)?.[1];
    const hours = block.match(/<hoursOnRecord>([\d.,]+)<\/hoursOnRecord>/)?.[1];
    if (appID && name) {
      games.push({
        appid: appID,
        name: decodeXmlEntities(name),
        hours: hours ? parseFloat(hours.replace(',', '.')) : 0,
      });
    }
  }
  return games;
}

function buildXmlUrl(input) {
  const s = input.trim().replace(/\/$/, '');
  // Full profile URL already
  if (s.startsWith('https://steamcommunity.com/') || s.startsWith('http://steamcommunity.com/')) {
    return `${s}/games/?tab=all&xml=1`;
  }
  // 64-bit Steam ID
  if (/^7656\d{13}$/.test(s)) {
    return `https://steamcommunity.com/profiles/${s}/games/?tab=all&xml=1`;
  }
  // Vanity name
  return `https://steamcommunity.com/id/${encodeURIComponent(s)}/games/?tab=all&xml=1`;
}

async function importSteamGames({ userId, steamId }) {
  const url = buildXmlUrl(steamId);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let text;
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'text/xml,application/xml' } });
    if (!r.ok) throw new Error(`Steam returned HTTP ${r.status}. Make sure your profile is public.`);
    text = await r.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Steam request timed out. Try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!text.includes('<gamesList>')) {
    throw new Error('Steam profile not found or Game Details are set to Private. Set Game Details to Public in Steam → Privacy Settings.');
  }

  const games = parseGamesXml(text);
  if (!games.length) throw new Error('No games found. Set Game Details to Public in Steam → Privacy Settings.');

  let added = 0, already = 0;
  for (const g of games) {
    const extId = String(g.appid);
    const dup = await db.get(
      "SELECT id FROM library_items WHERE user_id = ? AND category = 'games' AND (external_id = ? OR LOWER(title) = LOWER(?))",
      [userId, extId, g.name]
    );
    if (dup) { already++; continue; }
    const cover = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_600x900_2x.jpg`;
    await db.run(
      'INSERT INTO library_items (user_id, category, title, thumbnail_url, external_id, metadata, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, 'games', g.name, cover, extId,
        JSON.stringify({ platform: 'PC (Steam)', playtime_hours: Math.round(g.hours), appid: g.appid }),
        'steam']
    );
    added++;
  }
  return { added, already, total: games.length };
}

module.exports = { importSteamGames };
