const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/db');
const { requireAdmin } = require('../middleware/auth');
const { ensureAttendance, getFullAttendance, updateAttendanceFields, setAttendeeTypes } = require('../db/attendanceHelpers');

const router = express.Router();
router.use(requireAdmin);

// ---------- Users ----------
router.get('/users', (req, res) => {
  res.json(db.prepare('SELECT id, name, username, role, created_at FROM users ORDER BY name').all());
});

router.post('/users', (req, res) => {
  const { name, username, password, role } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username, and password are required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?,?)')
      .run(name.trim(), username.trim(), hash, role === 'admin' ? 'admin' : 'staff');
    res.json(db.prepare('SELECT id, name, username, role FROM users WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'Username already taken' });
  }
});

router.put('/users/:id', (req, res) => {
  const { name, role, newPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET name = ?, role = ? WHERE id = ?')
    .run(name ?? user.name, role === 'admin' ? 'admin' : 'staff', req.params.id);
  if (newPassword) {
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.params.id);
  }
  res.json(db.prepare('SELECT id, name, username, role FROM users WHERE id = ?').get(req.params.id));
});

router.delete('/users/:id', (req, res) => {
  if (parseInt(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: "You can't delete your own account while logged in" });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Edit / view any staff member's attendance for an event ----------
router.get('/attendance/:eventId/:userId', (req, res) => {
  const data = getFullAttendance(req.params.eventId, req.params.userId);
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

router.put('/attendance/:eventId/:userId', (req, res) => {
  const { attending, attendeeTypes, projectNames, ...travelFields } = req.body || {};
  const att = ensureAttendance(req.params.eventId, req.params.userId);

  if (typeof attending === 'boolean') {
    db.prepare('UPDATE attendance SET attending = ? WHERE id = ?').run(attending ? 1 : 0, att.id);
  }
  if (Array.isArray(attendeeTypes)) {
    setAttendeeTypes(att.id, attendeeTypes);
  }
  if (Array.isArray(projectNames)) {
    db.prepare('DELETE FROM attendance_projects WHERE attendance_id = ?').run(att.id);
    const insertProj = db.prepare('INSERT OR IGNORE INTO attendance_projects (attendance_id, project_id) VALUES (?,?)');
    for (const pname of projectNames) {
      const p = db.prepare('SELECT id FROM projects WHERE name = ?').get(pname);
      if (p) insertProj.run(att.id, p.id);
    }
  }
  updateAttendanceFields(att.id, travelFields);
  res.json(getFullAttendance(req.params.eventId, req.params.userId));
});

router.post('/attendance/:eventId/:userId/meetings', (req, res) => {
  const att = ensureAttendance(req.params.eventId, req.params.userId);
  db.prepare('INSERT INTO meetings (attendance_id, text) VALUES (?, ?)').run(att.id, req.body.text || '');
  res.json(getFullAttendance(req.params.eventId, req.params.userId));
});
router.post('/attendance/:eventId/:userId/people', (req, res) => {
  const att = ensureAttendance(req.params.eventId, req.params.userId);
  db.prepare('INSERT INTO people_to_talk (attendance_id, text) VALUES (?, ?)').run(att.id, req.body.text || '');
  res.json(getFullAttendance(req.params.eventId, req.params.userId));
});
router.post('/attendance/:eventId/:userId/sessions', (req, res) => {
  const att = ensureAttendance(req.params.eventId, req.params.userId);
  db.prepare('INSERT INTO sessions_agenda (attendance_id, title, date, time, location) VALUES (?,?,?,?,?)')
    .run(att.id, '', '', '', '');
  res.json(getFullAttendance(req.params.eventId, req.params.userId));
});

// ---------- Full data export (pull everything, for every person) ----------
router.get('/export', (req, res) => {
  const users = db.prepare('SELECT id, name, username, role FROM users ORDER BY name').all();
  const events = db.prepare('SELECT * FROM events ORDER BY created_at').all();
  const full = events.map(ev => ({
    event: ev,
    attendees: users.map(u => getFullAttendance(ev.id, u.id)).filter(a => a && (a.attending || a.registered)),
  }));
  if (req.query.format === 'csv') {
    const rows = [['Event','Location','Dates','Reg Fee','Vendor Fee','Staff','Attending As','Projects','Registered','Accommodations Booked','Hotel','Transportation Booked']];
    full.forEach(({ event, attendees }) => {
      attendees.forEach(a => {
        rows.push([
          event.name, event.location, event.dates, event.reg_fee, event.vendor_fee,
          a.userName || '', (a.attendeeTypes||[]).join('; '), (a.projects||[]).join('; '),
          a.registered ? 'Y' : 'N', a.accommodationsBooked ? 'Y' : 'N', a.hotelName || '',
          a.transportationBooked ? 'Y' : 'N',
        ]);
      });
    });
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="conference-ops-export.csv"');
    return res.send(csv);
  }
  res.json({ users, events: full });
});

// ---------- Branding settings ----------
router.get('/settings', (req, res) => {
  res.json(readSettings());
});
router.put('/settings', (req, res) => {
  const { companyName, accentColor } = req.body || {};
  if (companyName !== undefined) setSetting('companyName', companyName);
  if (accentColor !== undefined) setSetting('accentColor', accentColor);
  res.json(readSettings());
});

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, 'logo' + path.extname(file.originalname)),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|svg\+xml|webp)$/.test(file.mimetype)) {
      return cb(new Error('Logo must be a PNG, JPG, SVG, or WebP image'));
    }
    cb(null, true);
  },
});

router.post('/logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  setSetting('logoPath', '/uploads/' + req.file.filename);
  res.json(readSettings());
});

function readSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { companyName: 'Conference Ops', accentColor: '#1F6F5C', logoPath: null };
  rows.forEach(r => { s[r.key] = r.value; });
  return s;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

module.exports = router;
