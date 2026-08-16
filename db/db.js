const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff', -- 'admin' | 'staff'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  dates TEXT,
  website TEXT,
  reg_fee REAL DEFAULT 0,
  vendor_fee REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attending INTEGER NOT NULL DEFAULT 0,
  registered INTEGER NOT NULL DEFAULT 0,
  accommodations_booked INTEGER NOT NULL DEFAULT 0,
  hotel_name TEXT DEFAULT '',
  hotel_address TEXT DEFAULT '',
  transportation_booked INTEGER NOT NULL DEFAULT 0,
  flight_info TEXT DEFAULT '',
  rental_car_info TEXT DEFAULT '',
  train_info TEXT DEFAULT '',
  UNIQUE(event_id, user_id)
);

CREATE TABLE IF NOT EXISTS attendance_projects (
  attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (attendance_id, project_id)
);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  text TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS people_to_talk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  text TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions_agenda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  title TEXT DEFAULT '',
  date TEXT DEFAULT '',
  time TEXT DEFAULT '',
  location TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS attendance_types (
  attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  PRIMARY KEY (attendance_id, type)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// --- Lightweight migrations: add columns if they don't exist yet. ---
// SQLite has no "ADD COLUMN IF NOT EXISTS", so we check pragma table_info
// first. This runs on every start but is a no-op once the columns exist,
// and never touches existing rows/data.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('events', 'start_date', "TEXT DEFAULT ''");
ensureColumn('events', 'end_date', "TEXT DEFAULT ''");
ensureColumn('attendance', 'attendee_type', "TEXT DEFAULT ''"); // legacy single-value column, kept for backfill only

// One-time backfill: attendee_type used to be a single value before we
// switched to multi-select. Carry any existing values into the new
// attendance_types table so nothing entered during that window is lost.
// Safe to run every startup — it only inserts rows that don't exist yet.
const legacyTyped = db.prepare("SELECT id, attendee_type FROM attendance WHERE attendee_type != ''").all();
const insertType = db.prepare('INSERT OR IGNORE INTO attendance_types (attendance_id, type) VALUES (?, ?)');
for (const row of legacyTyped) {
  insertType.run(row.id, row.attendee_type);
}

// Bootstrap an initial admin account on first run, from env vars.
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const name = process.env.ADMIN_NAME || 'Admin';
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?,?)')
    .run(name, username, hash, 'admin');
  console.log('----------------------------------------------------');
  console.log('No users found — created a bootstrap admin account:');
  console.log(`  username: ${username}`);
  console.log(`  password: ${password}`);
  console.log('Log in and change this password immediately (or set');
  console.log('ADMIN_USERNAME / ADMIN_PASSWORD in .env before first run).');
  console.log('----------------------------------------------------');
}

module.exports = db;
