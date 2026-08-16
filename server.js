require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');

const db = require('./db/db'); // also runs schema init / bootstrap admin

const app = express();
app.set('trust proxy', 1); // required behind Nginx so secure cookies work correctly over HTTPS
const PORT = process.env.PORT || 3000;

const sessionsDir = path.join(__dirname, 'db', 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

app.use(express.json());
app.use(session({
  store: new FileStore({ path: sessionsDir, logFn: () => {} }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-before-deploying',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // requires HTTPS in production (see README)
    sameSite: 'lax',
  },
}));

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
app.use('/api/roster', require('./routes/roster'));
app.use('/api/me', require('./routes/me'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/settings', require('./routes/settings'));

// Serve the SPA shell for everything else (client-side routing not really
// used here, but this keeps direct links to /app or /login working).
app.get(['/app', '/app.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/', (req, res) => res.redirect('/login.html'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Conference Ops running on http://localhost:${PORT}`);
});
