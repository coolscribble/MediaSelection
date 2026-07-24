'use strict';

const { db } = require('../database');

const BASE = 'https://retroachievements.org/API';
const MEDIA = 'https://media.retroachievements.org';

function thumb(icon) {
  if (!icon) return null;
  return `${MEDIA}${icon.startsWith('/') ? '' : '/'}${icon}`;
}

async function raFetch(endpoint, params) {
  const url = `${BASE}/${endpoint}?${new URLSearchParams(params)}`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'mediapicker/1.0' } });
  if (!resp.ok) throw new Error(`RetroAchievements API error ${resp.status} on ${endpoint}`);
  return resp.json();
}

async function getAllRecentlyPlayed(username, apiKey) {
  const games = [];
  const per = 50;
  let offset = 0;
  while (true) {
    const data = await raFetch('API_GetUserRecentlyPlayedGames.php', {
      z: username, y: apiKey, c: per, o: offset,
    });
    if (!Array.isArray(data) || data.length === 0) break;
    games.push(...data);
    if (data.length < per) break;
    offset += per;
    await new Promise(r => setTimeout(r, 250));
  }
  return games;
}

async function getCompletedGames(username, apiKey) {
  const data = await raFetch('API_GetUserCompletedGames.php', { z: username, y: apiKey });
  return Array.isArray(data) ? data : [];
}

async function syncRetroAchievements(userId) {
  const [userRow, keyRow, skipRow] = await Promise.all([
    db.get("SELECT value FROM settings WHERE user_id = ? AND key = 'ra_username'", [userId]),
    db.get("SELECT value FROM settings WHERE user_id = ? AND key = 'ra_api_key'", [userId]),
    db.get("SELECT value FROM settings WHERE user_id = ? AND key = 'ra_skip_mastered'", [userId]),
  ]);

  if (!userRow?.value || !keyRow?.value) {
    throw new Error('RetroAchievements not configured (missing username or API key)');
  }

  const username = userRow.value.trim();
  const apiKey = keyRow.value.trim();
  const skipMastered = skipRow?.value === 'true';

  const [recent, completed] = await Promise.all([
    getAllRecentlyPlayed(username, apiKey),
    getCompletedGames(username, apiKey),
  ]);

  // Merge into unified map keyed by GameID
  const gamesMap = new Map();

  for (const g of recent) {
    if (!g.GameID || !g.Title) continue;
    const total = g.NumPossibleAchievements || 0;
    const earned = g.NumAchieved || 0;
    const pct = total > 0 ? Math.round((earned / total) * 100) : 0;
    gamesMap.set(g.GameID, {
      id: g.GameID,
      title: g.Title,
      console: g.ConsoleName || '',
      icon: g.ImageIcon,
      earned,
      total,
      pct,
      hardcoreEarned: g.NumAchievedHardcore || 0,
    });
  }

  for (const g of completed) {
    if (!g.GameID || !g.Title || gamesMap.has(g.GameID)) continue;
    const pct = Math.round(parseFloat(g.PctWon || '0') * 100);
    gamesMap.set(g.GameID, {
      id: g.GameID,
      title: g.Title,
      console: g.ConsoleName || '',
      icon: g.ImageIcon,
      earned: g.NumAwarded || 0,
      total: g.MaxPossible || 0,
      pct,
      hardcoreEarned: g.HardcoreMode === '1' ? (g.NumAwarded || 0) : 0,
    });
  }

  let added = 0, updated = 0, skipped = 0;

  for (const game of gamesMap.values()) {
    if (skipMastered && game.pct === 100) { skipped++; continue; }

    const thumbnail = thumb(game.icon);
    const raMeta = {
      ra_game_id: game.id,
      ra_achievements_earned: game.earned,
      ra_achievements_total: game.total,
      ra_completion_pct: game.pct,
      ra_hardcore_earned: game.hardcoreEarned,
    };
    const extId = String(game.id);

    // Check if already tracked as RA source
    const existingRA = await db.get(
      "SELECT id FROM library_items WHERE user_id = ? AND category = 'games' AND external_id = ? AND source = 'retroachievements'",
      [userId, extId]
    );

    if (existingRA) {
      const existingMeta = await db.get('SELECT metadata FROM library_items WHERE id = ?', [existingRA.id]);
      const merged = JSON.stringify({ ...JSON.parse(existingMeta?.metadata || '{}'), ...raMeta, console: game.console });
      await db.run('UPDATE library_items SET metadata = ?, title = ? WHERE id = ?', [merged, game.title, existingRA.id]);
      updated++;
      continue;
    }

    // Merge RA data into existing entry by title match (from IGDB/Steam/etc)
    const sameTitle = await db.get(
      "SELECT id, metadata FROM library_items WHERE user_id = ? AND category = 'games' AND LOWER(title) = LOWER(?)",
      [userId, game.title]
    );

    if (sameTitle) {
      const merged = JSON.stringify({ ...JSON.parse(sameTitle.metadata || '{}'), ...raMeta });
      await db.run('UPDATE library_items SET metadata = ? WHERE id = ?', [merged, sameTitle.id]);
      updated++;
    } else {
      const metadata = JSON.stringify({ console: game.console, ...raMeta });
      await db.run(
        "INSERT INTO library_items (user_id, category, title, external_id, thumbnail_url, metadata, source) VALUES (?, 'games', ?, ?, ?, ?, 'retroachievements')",
        [userId, game.title, extId, thumbnail, metadata]
      );
      added++;
    }
  }

  return { added, updated, skipped, total: gamesMap.size };
}

module.exports = { syncRetroAchievements };
