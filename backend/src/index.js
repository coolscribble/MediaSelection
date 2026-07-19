const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { init, cleanExpiredSessions } = require('./database');
const { migrateCovers } = require('./services/imageCache');
const { requireAuth } = require('./middleware/auth');

const app = express();

// Security headers
app.use(helmet());

// CORS — restrict to configured origin; credentials required for httpOnly cookies
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: allowedOrigin, credentials: true }));

app.use(cookieParser());
app.use(express.json());

// Public routes — no auth required
app.use('/api/auth', require('./routes/auth'));
app.use('/api/covers', require('./routes/covers')); // <img src> can't send credentials

// Protected routes — all require a valid session token
const api = express.Router();
api.use(requireAuth);
api.use('/slots',    require('./routes/slots'));
api.use('/library',  require('./routes/library'));
api.use('/sync',     require('./routes/sync'));
api.use('/import',   require('./routes/import'));
api.use('/settings', require('./routes/settings'));
api.use('/queue',    require('./routes/queue'));
api.use('/ongoing',  require('./routes/ongoing'));
api.use('/stats',    require('./routes/stats'));
app.use('/api', api);

const STATIC_DIR = path.join(__dirname, '../public');
if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  app.get('*', (req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));
}

const PORT = process.env.PORT || 3000;

init().then(async () => {
  await migrateCovers();
  // Prune expired sessions on startup, then every hour
  await cleanExpiredSessions();
  setInterval(cleanExpiredSessions, 60 * 60 * 1000);
  app.listen(PORT, () => console.log(`MediaPicker on http://localhost:${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
