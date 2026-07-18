const path = require('path');
const fs = require('fs');
const { db } = require('../database');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const COVERS_DIR = path.join(DATA_DIR, 'covers');

async function isCachingEnabled() {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', ['save_covers_locally']);
  return row?.value === 'true';
}

function guessExt(url) {
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

async function cacheImage(itemId, remoteUrl) {
  if (!remoteUrl) return remoteUrl;
  if (!await isCachingEnabled()) return remoteUrl;

  try {
    if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

    const ext = guessExt(remoteUrl);
    const filename = `${itemId}.${ext}`;
    const filepath = path.join(COVERS_DIR, filename);

    const r = await fetch(remoteUrl, { headers: { 'User-Agent': 'MediaPicker/1.0' } });
    if (!r.ok) return remoteUrl;

    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(filepath, buf);
    return `/api/covers/${filename}`;
  } catch {
    return remoteUrl;
  }
}

module.exports = { cacheImage };
