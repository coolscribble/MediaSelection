const { db } = require('../database');

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  const token = auth.slice(7);
  const session = await db.get('SELECT user_id FROM sessions WHERE token = ?', [token]);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });
  req.userId = session.user_id;
  next();
}

module.exports = { requireAuth };
