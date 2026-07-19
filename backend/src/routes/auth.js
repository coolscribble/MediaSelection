const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { db, ensureUserSlots } = require('../database');

const EMBY_AUTH = 'MediaBrowser Client="MediaPicker", Device="Browser", DeviceId="mediapicker-web", Version="1.0.0"';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_TTL_SECONDS * 1000,
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Block private/loopback addresses to prevent SSRF
function isSafeUrl(urlStr) {
  let url;
  try { url = new URL(urlStr); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blocked = ['localhost', '::1', '0.0.0.0'];
  if (blocked.includes(host)) return false;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1]), parseInt(ipv4[2])];
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 0) return false;
  }
  // Block IPv6 private ranges (starts with fc/fd) and link-local (fe80)
  if (/^(fc|fd|fe80)/i.test(host)) return false;
  return true;
}

async function createSession(userId) {
  const token = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [token, userId, expiresAt]);
  return token;
}

router.post('/login', loginLimiter, async (req, res) => {
  const { serverUrl, username, password } = req.body;
  if (!serverUrl || !username || !password) {
    return res.status(400).json({ error: 'serverUrl, username and password are required' });
  }
  if (!isSafeUrl(serverUrl)) {
    return res.status(400).json({ error: 'Invalid server URL' });
  }

  const base = serverUrl.replace(/\/+$/, '');

  try {
    const r = await fetch(`${base}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: EMBY_AUTH,
        'X-Emby-Authorization': EMBY_AUTH,
      },
      body: JSON.stringify({ Username: username, Pw: password }),
    });

    if (r.status === 401) return res.status(401).json({ error: 'Invalid username or password' });
    if (!r.ok) return res.status(502).json({ error: 'Jellyfin server returned an error' });

    const data = await r.json();
    const displayName = data.User?.Name || username;
    const jellyfinId = data.User?.Id || null;
    const userId = displayName.toLowerCase();

    await db.run(
      'INSERT OR REPLACE INTO users (username, server_url, jellyfin_id) VALUES (?, ?, ?)',
      [userId, base, jellyfinId]
    );
    await ensureUserSlots(userId);

    const token = await createSession(userId);
    res.cookie('mp_session', token, COOKIE_OPTS);
    res.json({ username: displayName });
  } catch (e) {
    console.error('[auth/login]', e);
    const code = e?.cause?.code || e?.code;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      return res.status(502).json({ error: 'Cannot connect to Jellyfin — check the server URL' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/local', loginLimiter, async (req, res) => {
  const passcode = process.env.LOCAL_PASSCODE;
  if (passcode) {
    if (req.body?.passcode !== passcode) {
      return res.status(401).json({ error: 'Passcode required for local login' });
    }
  }

  const userId = 'local';
  try {
    await db.run(
      'INSERT OR IGNORE INTO users (username, server_url) VALUES (?, ?)',
      [userId, '']
    );
    await ensureUserSlots(userId);
    const token = await createSession(userId);
    res.cookie('mp_session', token, COOKIE_OPTS);
    res.json({ username: 'local' });
  } catch (e) {
    console.error('[auth/local]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', async (req, res) => {
  const token = req.cookies?.mp_session || req.headers.authorization?.slice(7);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const now = Math.floor(Date.now() / 1000);
  const session = await db.get(
    'SELECT user_id, expires_at FROM sessions WHERE token = ?',
    [token]
  );
  if (!session) return res.status(401).json({ error: 'Invalid session' });
  if (session.expires_at && session.expires_at < now) {
    await db.run('DELETE FROM sessions WHERE token = ?', [token]);
    return res.status(401).json({ error: 'Session expired' });
  }

  const user = await db.get('SELECT username, server_url FROM users WHERE username = ?', [session.user_id]);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ userId: session.user_id, username: user.username, serverUrl: user.server_url });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.mp_session || req.headers.authorization?.slice(7);
  if (token) {
    await db.run('DELETE FROM sessions WHERE token = ?', [token]).catch(() => {});
  }
  res.clearCookie('mp_session', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
  res.json({ success: true });
});

module.exports = router;
