const { db } = require('../database');

async function requireAuth(req, res, next) {
  // Accept token from httpOnly cookie (preferred) or Authorization header (fallback)
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

  req.userId = session.user_id;
  next();
}

module.exports = { requireAuth };
