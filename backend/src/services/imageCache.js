const path = require('path');
const fs = require('fs');
const { db } = require('../database');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const COVERS_DIR = path.join(DATA_DIR, 'covers');

function titleSlug(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function isCachingEnabled() {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', ['save_covers_locally']);
  return row?.value === 'true';
}

function extFromResponse(response, url) {
  const ct = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/png')  return 'png';
  if (ct === 'image/gif')  return 'gif';
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'jpg';
  try {
    const clean = url.split('?')[0];
    const last = clean.split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot >= 0) {
      const ext = last.slice(dot + 1).toLowerCase();
      if (ext && ext.length <= 4) return ext;
    }
  } catch {}
  return 'jpg';
}

// Returns local URL if a cached file already exists for category + key, null otherwise.
function checkCachedCover(category, key) {
  const subdir = path.join(COVERS_DIR, category);
  for (const ext of ['webp', 'jpg', 'png', 'gif']) {
    const fp = path.join(subdir, `${key}.${ext}`);
    if (fs.existsSync(fp)) return `/api/covers/${category}/${key}.${ext}`;
  }
  return null;
}

// category: 'games' | 'albums' | 'comics' | 'anime' | 'manga' | 'series' | 'movies'
// key: stable identifier, e.g. 'igdb_211243', 'anilist_12345', 'spider-man'
// If a cached file already exists for the key, returns the local URL immediately — no re-download.
async function cacheImage(category, key, remoteUrl) {
  if (!remoteUrl) return remoteUrl;
  if (!await isCachingEnabled()) return remoteUrl;

  const subdir = path.join(COVERS_DIR, category);

  try {
    if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });

    for (const ext of ['webp', 'jpg', 'png', 'gif']) {
      const existing = path.join(subdir, `${key}.${ext}`);
      if (fs.existsSync(existing)) return `/api/covers/${category}/${key}.${ext}`;
    }

    const r = await fetch(remoteUrl, { headers: { 'User-Agent': 'MediaPicker/1.0' } });
    if (!r.ok) return remoteUrl;

    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return remoteUrl;

    const ext = extFromResponse(r, remoteUrl);
    const filename = `${key}.${ext}`;
    const filepath = path.join(subdir, filename);

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 512) return remoteUrl;
    fs.writeFileSync(filepath, buf);
    return `/api/covers/${category}/${filename}`;
  } catch {
    return remoteUrl;
  }
}

// Runs once at startup: moves flat legacy files (e.g. 42.jpg, comics_foo.jpg) into
// category subdirectories with stable names so covers survive library re-imports.
async function migrateCovers() {
  try {
    if (!fs.existsSync(COVERS_DIR)) return;

    const entries = fs.readdirSync(COVERS_DIR, { withFileTypes: true });
    const flatFiles = entries.filter(e => e.isFile()).map(e => e.name);
    if (!flatFiles.length) return;

    console.log(`[imageCache] migrating ${flatFiles.length} flat cover files to category subdirs...`);
    let moved = 0;

    for (const file of flatFiles) {
      const parsed = path.parse(file);
      const base = parsed.name;
      const ext = parsed.ext;

      try {
        if (base.startsWith('comics_')) {
          // comics_spider-man.jpg → covers/comics/spider-man.jpg
          const slug = base.slice('comics_'.length);
          const destDir = path.join(COVERS_DIR, 'comics');
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          fs.renameSync(path.join(COVERS_DIR, file), path.join(destDir, `${slug}${ext}`));
          await db.run(
            'UPDATE library_items SET thumbnail_url = ? WHERE thumbnail_url = ?',
            [`/api/covers/comics/${slug}${ext}`, `/api/covers/${file}`]
          );
          moved++;
        } else if (/^\d+$/.test(base)) {
          // ID-named file: look up the item to get category + stable key
          const id = parseInt(base, 10);
          const item = await db.get(
            'SELECT id, category, title, external_id, metadata FROM library_items WHERE id = ?',
            [id]
          );
          if (!item) continue; // orphaned file — leave it in place

          const meta = JSON.parse(item.metadata || '{}');
          let stableKey;

          if (item.category === 'games') {
            stableKey = item.external_id ? `igdb_${item.external_id}` : `game_${titleSlug(item.title)}`;
          } else if (item.category === 'albums') {
            stableKey = meta.mb_id ? `mb_${meta.mb_id}`
              : meta.deezer_id ? `dz_${meta.deezer_id}`
              : meta.itunes_id ? `it_${meta.itunes_id}`
              : `album_${titleSlug(item.title)}`;
          } else if (item.category === 'anime') {
            stableKey = item.external_id ? `anilist_${item.external_id}` : `anime_${titleSlug(item.title)}`;
          } else if (item.category === 'manga') {
            stableKey = item.external_id ? `anilist_${item.external_id}` : `manga_${titleSlug(item.title)}`;
          } else if (item.category === 'series') {
            stableKey = item.external_id ? `simkl_${item.external_id}` : `series_${titleSlug(item.title)}`;
          } else if (item.category === 'movies') {
            stableKey = item.external_id ? `movie_${item.external_id}` : `movie_${titleSlug(item.title)}`;
          } else {
            stableKey = `${item.category}_${titleSlug(item.title)}`;
          }

          const destDir = path.join(COVERS_DIR, item.category);
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

          // Avoid overwriting if a stable-named file already exists
          const destPath = path.join(destDir, `${stableKey}${ext}`);
          if (!fs.existsSync(destPath)) {
            fs.renameSync(path.join(COVERS_DIR, file), destPath);
          } else {
            fs.unlinkSync(path.join(COVERS_DIR, file)); // duplicate, remove old
          }

          await db.run(
            'UPDATE library_items SET thumbnail_url = ? WHERE id = ?',
            [`/api/covers/${item.category}/${stableKey}${ext}`, id]
          );
          moved++;
        }
      } catch (e) {
        console.warn(`[imageCache] could not migrate ${file}: ${e.message}`);
      }
    }

    console.log(`[imageCache] migration done: ${moved}/${flatFiles.length} files moved`);
  } catch (e) {
    console.error('[imageCache] migration error:', e.message);
  }
}

module.exports = { cacheImage, checkCachedCover, titleSlug, migrateCovers, COVERS_DIR };
