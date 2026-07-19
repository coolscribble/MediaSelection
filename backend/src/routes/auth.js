const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db, ensureUserSlots } = require('../database');

const EMBY_AUTH = 'MediaBrowser Client="MediaPicker", Device="Browser", DeviceId="mediapicker-web", Version="1.0.0"';

router.post('/login', async (req, res) => {
  const { serverUrl, username, password } = req.body;
  if (!serverUrl || !username || !password) {
    return res.status(400).json({ error: 'serverUrl, username and password are required' });
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
    if (!r.ok) return res.status(502).json({ error: `Jellyfin server error: ${r.status}` });

    const data = await r.json();
    const displayName = data.User?.Name || username;
    const jellyfinId = data.User?.Id || null;
    const userId = displayName.toLowerCase();

    await db.run(
      'INSERT OR REPLACE INTO users (username, server_url, jellyfin_id) VALUES (?, ?, ?)',
      [userId, base, jellyfinId]
    );
    await ensureUserSlots(userId);

    const token = crypto.randomUUID();
    await db.run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, userId]);

    res.json({ token, userId, username: displayName });
  } catch (e) {
    const code = e?.cause?.code || e?.code;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      return res.status(502).json({ error: 'Cannot connect to Jellyfin — check the server URL' });
    }
    res.status(500).json({ error: e.message });
  }
});

router.post('/local', async (req, res) => {
  const userId = 'local';
  try {
    await db.run(
      'INSERT OR IGNORE INTO users (username, server_url) VALUES (?, ?)',
      [userId, '']
    );
    await ensureUserSlots(userId);
    const token = crypto.randomUUID();
    await db.run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, userId]);
    res.json({ token, userId, username: 'local' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  const token = auth.slice(7);
  const session = await db.get('SELECT user_id FROM sessions WHERE token = ?', [token]);
  if (!session) return res.status(401).json({ error: 'Invalid session' });
  const user = await db.get('SELECT username, server_url FROM users WHERE username = ?', [session.user_id]);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ userId: session.user_id, username: user.username, serverUrl: user.server_url });
});

router.post('/logout', async (req, res) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    await db.run('DELETE FROM sessions WHERE token = ?', [auth.slice(7)]).catch(() => {});
  }
  res.json({ success: true });
});

module.exports = router;
