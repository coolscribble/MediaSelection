const path = require('path');
const fs = require('fs');
const { db } = require('../database');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const COVERS_DIR = path.join(DATA_DIR, 'covers');

async function isCachingEnabled() {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', ['save_covers_locally']);
  return row?.value === 'true';
}

// Derive a safe file extension from the HTTP Content-Type header, falling back to the URL path
function extFromResponse(response, url) {
  const ct = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/png')  return 'png';
  if (ct === 'image/gif')  return 'gif';
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'jpg';
  // Fall back to URL path extension
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

// key: stable string identifier for this asset (e.g. "comics_spider-man" or "42" for an ID).
// If a cached file already exists for the key, returns the local URL immediately — no re-download.
async function cacheImage(key, remoteUrl) {
  if (!remoteUrl) return remoteUrl;
  if (!await isCachingEnabled()) return remoteUrl;

  try {
    if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

    // Check all possible extensions — if any cached version exists, return it
    for (const ext of ['jpg', 'webp', 'png', 'gif']) {
      const existing = path.join(COVERS_DIR, `${key}.${ext}`);
      if (fs.existsSync(existing)) return `/api/covers/${key}.${ext}`;
    }

    const r = await fetch(remoteUrl, { headers: { 'User-Agent': 'MediaPicker/1.0' } });
    if (!r.ok) return remoteUrl;

    // Reject non-image responses (error pages, redirects served as HTML, etc.)
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return remoteUrl;

    const ext = extFromResponse(r, remoteUrl);
    const filename = `${key}.${ext}`;
    const filepath = path.join(COVERS_DIR, filename);

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 512) return remoteUrl; // reject suspiciously small files
    fs.writeFileSync(filepath, buf);
    return `/api/covers/${filename}`;
  } catch {
    return remoteUrl;
  }
}

module.exports = { cacheImage };
