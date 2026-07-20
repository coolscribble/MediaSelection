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
  if (s.startsWith('https://steamcommunity.com/') || s.startsWith('http://steamcommunity.com/')) {
    return s.includes('/games') ? s : `${s}/games/?tab=all&xml=1`;
  }
  if (/^7656\d{13}$/.test(s)) {
    return `https://steamcommunity.com/profiles/${s}/games/?tab=all&xml=1`;
  }
  return `https://steamcommunity.com/id/${encodeURIComponent(s)}/games/?tab=all&xml=1`;
}

async function importSteamGames({ userId, steamId, sessionCookie }) {
  const url = buildXmlUrl(steamId);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let text;
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/xml,application/xml,*/*',
        'Cookie': `steamLoginSecure=${sessionCookie.trim()}`,
      },
    });
    if (!r.ok) throw new Error(`Steam returned HTTP ${r.status}`);
    text = await r.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Steam request timed out. Try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!text.includes('<gamesList>')) {
    if (text.includes('<title>Sign In</title>') || text.includes('login')) {
      throw new Error('Steam session token is invalid or expired. Get a fresh steamLoginSecure cookie and try again.');
    }
    throw new Error('Steam did not return game data. Check your username and try a fresh session token.');
  }

  const games = parseGamesXml(text);
  if (!games.length) throw new Error('No games found. Make sure Game Details is set to Public in Steam → Privacy Settings.');

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
