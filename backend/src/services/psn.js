const { db } = require('../database');

let _psn;
async function api() {
  if (!_psn) _psn = await import('psn-api');
  return _psn;
}

async function importPSNGames({ userId, npsso, skipCompleted = false, platforms = null }) {
  const { exchangeNpssoForCode, exchangeCodeForAccessToken, getUserTitlesAndTrophyGroups } = await api();

  const code = await exchangeNpssoForCode(npsso);
  const auth = await exchangeCodeForAccessToken(code);

  const allTitles = [];
  const limit = 800;
  let offset = 0;
  while (true) {
    const res = await getUserTitlesAndTrophyGroups(auth, 'me', { limit, offset });
    const batch = res.trophyTitles ?? [];
    allTitles.push(...batch);
    if (allTitles.length >= (res.totalItemCount ?? allTitles.length)) break;
    offset += limit;
  }

  let added = 0, skipped = 0, already = 0;

  for (const t of allTitles) {
    const name = t.trophyTitleName?.trim();
    if (!name) { skipped++; continue; }

    const platform = (t.trophyTitlePlatform ?? '').toUpperCase();
    if (platforms && platforms.length > 0 && !platforms.includes(platform)) { skipped++; continue; }
    if (skipCompleted && t.progress === 100) { skipped++; continue; }

    const existing = await db.get(
      'SELECT id FROM library_items WHERE user_id = ? AND category = ? AND title = ?',
      [userId, 'games', name]
    );
    if (existing) { already++; continue; }

    await db.run(
      'INSERT INTO library_items (user_id, category, title, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'games', name, t.trophyTitleIconUrl || null, JSON.stringify({ platform, trophyProgress: t.progress }), 'psn']
    );
    added++;
  }

  return { added, skipped, already, total: allTitles.length };
}

module.exports = { importPSNGames };
