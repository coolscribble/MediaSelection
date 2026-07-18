const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { init } = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/slots', require('./routes/slots'));
app.use('/api/library', require('./routes/library'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/import', require('./routes/import'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/queue',    require('./routes/queue'));
app.use('/api/ongoing', require('./routes/ongoing'));
app.use('/api/stats',   require('./routes/stats'));
app.use('/api/covers',  require('./routes/covers'));

const STATIC_DIR = path.join(__dirname, '../public');
if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  app.get('*', (req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));
}

const PORT = process.env.PORT || 3000;

init().then(() => {
  app.listen(PORT, () => console.log(`MediaPicker on http://localhost:${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
