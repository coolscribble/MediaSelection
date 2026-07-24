'use strict';

const BASE = 'https://howlongtobeat.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

let _key = null;
let _keyAt = 0;

async function fetchKey() {
  if (_key && Date.now() - _keyAt < 3_600_000) return _key;
  try {
    const html = await (await fetch(BASE, { headers: { 'User-Agent': UA, Accept: 'text/html' } })).text();
    const urls = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map(m => m[1]);
    for (const u of urls.slice(0, 12)) {
      try {
        const js = await (await fetch(`${BASE}${u}`, { headers: { 'User-Agent': UA } })).text();
        const m = js.match(/"\/api\/search\/"\.concat\("([a-f0-9]+)"\)/);
        if (m?.[1]) { _key = m[1]; _keyAt = Date.now(); console.log('[HLTB] key:', _key); return _key; }
      } catch { continue; }
    }
  } catch (e) { console.warn('[HLTB] key fetch failed:', e.message); }
  return null;
}

async function lookupHLTB(title) {
  const key = await fetchKey();
  if (!key) return null;

  const terms = title.replace(/['"()[\]]/g, '').trim().split(/\s+/).filter(Boolean);
  const body = JSON.stringify({
    searchType: 'games', searchTerms: terms, searchPage: 1, size: 5,
    searchOptions: {
      games: { userId: 0, platform: '', sortCategory: 'popular', rangeCategory: 'main',
               rangeTime: { min: null, max: null },
               gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
               rangeYear: { min: '', max: '' }, modifier: '' },
      users: { sortCategory: 'postcount' }, lists: { sortCategory: 'follows' },
      filter: '', sort: 0, randomizer: 0,
    },
  });

  try {
    const res = await fetch(`${BASE}/api/search/${key}`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Referer: `${BASE}/`, Origin: BASE },
      body,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data?.data;
    if (!results?.length) return null;

    const tl = title.toLowerCase();
    const best = results.find(r => r.game_name?.toLowerCase() === tl) || results[0];
    const secs = best.comp_main || best.comp_plus || best.comp_100 || 0;
    if (!secs) return null;

    return Math.round((secs / 3600) * 10) / 10;
  } catch (e) {
    console.warn('[HLTB] lookup failed for', title, ':', e.message);
    return null;
  }
}

module.exports = { lookupHLTB };
