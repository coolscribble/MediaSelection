const { db } = require('../database');
const { cacheImage } = require('./imageCache');

const GB_BASE = 'https://www.googleapis.com/books/v1/volumes';

async function searchGoogleBooks(title) {
  const q = encodeURIComponent(`intitle:${title}`);
  const r = await fetch(`${GB_BASE}?q=${q}&printType=books&maxResults=5`, {
    headers: { 'User-Agent': 'MediaPicker/1.0' },
  });
  if (!r.ok) return null;
  const data = await r.json();
  return (data.items || [])[0] || null;
}

function buildCoverUrl(item) {
  const links = item?.volumeInfo?.imageLinks;
  if (!links) return null;
  const url = links.thumbnail || links.smallThumbnail;
  if (!url) return null;
  // Upgrade to larger zoom and enforce HTTPS
  return url.replace('zoom=1', 'zoom=3').replace('&edge=curl', '').replace(/^http:/, 'https:');
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

function titleSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function syncGoogleBooks() {
  const comics = await db.all(
    "SELECT id, title, external_id, thumbnail_url, metadata FROM library_items WHERE category = 'comics'"
  );

  let updated = 0, skipped = 0;
  for (const comic of comics) {
    const result = await searchGoogleBooks(comic.title);
    let thumb = result ? buildCoverUrl(result) : null;
    if (!thumb) {
      thumb = await searchOpenLibrary(comic.title);
    }
    if (!thumb) { skipped++; continue; }

    // Use a title-slug key so cached covers survive CSV re-imports (new IDs, same title)
    const localThumb = await cacheImage(`comics_${titleSlug(comic.title)}`, thumb);
    const meta = JSON.parse(comic.metadata || '{}');
    const vi = result.volumeInfo || {};
    const merged = {
      ...meta,
      google_books_id: result.id,
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
