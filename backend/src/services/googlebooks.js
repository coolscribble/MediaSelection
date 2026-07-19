const { db } = require('../database');
const { cacheImage, titleSlug } = require('./imageCache');

const GB_BASE = 'https://www.googleapis.com/books/v1/volumes';

async function searchGoogleBooks(title) {
  // Try strict intitle: first, then broad search — prefer results that actually have image links
  for (const q of [encodeURIComponent(`intitle:${title}`), encodeURIComponent(title)]) {
    try {
      const r = await fetch(`${GB_BASE}?q=${q}&printType=books&maxResults=8`, {
        headers: { 'User-Agent': 'MediaPicker/1.0' },
      });
      if (!r.ok) continue;
      const data = await r.json();
      const items = data.items || [];
      const withImage = items.find(item => item.volumeInfo?.imageLinks);
      if (withImage) return withImage;
    } catch { /* try next */ }
    await new Promise(res => setTimeout(res, 150));
  }
  return null;
}

function buildCoverUrl(item) {
  const links = item?.volumeInfo?.imageLinks;
  if (!links) return null;
  // Prefer larger sizes
  const url = links.extraLarge || links.large || links.medium || links.thumbnail || links.smallThumbnail;
  if (!url) return null;
  let resolved = url.replace(/^http:/, 'https:').replace('&edge=curl', '');
  // Force zoom=3 for best quality (replaces existing zoom param or appends)
  if (resolved.includes('zoom=')) {
    resolved = resolved.replace(/zoom=\d/, 'zoom=3');
  } else {
    resolved += '&zoom=3';
  }
  return resolved;
}

async function searchOpenLibrary(title) {
  try {
    const q = encodeURIComponent(title);
    const r = await fetch(`https://openlibrary.org/search.json?title=${q}&fields=key,cover_i,title&limit=5`, {
      headers: { 'User-Agent': 'MediaPicker/1.0' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const item = (data.docs || []).find(d => d.cover_i) || null;
    return item?.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : null;
  } catch { return null; }
}


async function searchWikipedia(title) {
  try {
    const r = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=600&redirects=1&origin=*`,
      { headers: { 'User-Agent': 'MediaPicker/1.0' } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const pages = data.query?.pages || {};
    const page = Object.values(pages)[0];
    return (page?.thumbnail?.source) || null;
  } catch { return null; }
}

async function searchInternetArchive(title) {
  try {
    const r = await fetch(
      `https://archive.org/advancedsearch.php?q=title:(${encodeURIComponent(title)})+mediatype:texts&fl[]=identifier&rows=3&output=json`,
      { headers: { 'User-Agent': 'MediaPicker/1.0' } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const id = data.response?.docs?.[0]?.identifier;
    return id ? `https://archive.org/services/img/${id}` : null;
  } catch { return null; }
}

async function syncGoogleBooks({ itemId } = {}) {
  const query = itemId
    ? "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE category = 'comics' AND id = ?"
    : "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE category = 'comics'";
  const comics = itemId
    ? await db.all(query, [itemId])
    : await db.all(query);

  let updated = 0, skipped = 0;
  for (const comic of comics) {
    const result = await searchGoogleBooks(comic.title);
    let thumb = result ? buildCoverUrl(result) : null;
    if (!thumb) thumb = await searchOpenLibrary(comic.title);
    if (!thumb) thumb = await searchWikipedia(comic.title);
    if (!thumb) thumb = await searchInternetArchive(comic.title);
    if (!thumb) { skipped++; continue; }

    const localThumb = await cacheImage('comics', titleSlug(comic.title), thumb);
    const meta = JSON.parse(comic.metadata || '{}');
    const vi = result?.volumeInfo || {};
    const merged = {
      ...meta,
      ...(result?.id && { google_books_id: result.id }),
      ...(vi.authors?.length && { author: vi.authors[0] }),
      ...(vi.publishedDate && { year: vi.publishedDate.slice(0, 4) }),
      ...(vi.publisher && { publisher: vi.publisher }),
    };

    await db.run(
      'UPDATE library_items SET thumbnail_url = ?, metadata = ? WHERE id = ?',
      [localThumb, JSON.stringify(merged), comic.id]
    );
    updated++;

    await new Promise(res => setTimeout(res, 200));
  }

  return { updated, skipped };
}

module.exports = { syncGoogleBooks };
