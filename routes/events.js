const express = require('express');
const db = require('../db/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { ensureAttendance, getAttendeeTypes, setAttendeeTypes } = require('../db/attendanceHelpers');

const router = express.Router();
router.use(requireAuth);

// Includes each attendee's meetings and important sessions, since staff can
// see each other's shared planning info for an event. Deliberately leaves
// out hotel/flight/rental-car/train details — those stay personal and are
// only reachable via /api/me (your own) or /api/admin (any admin).
function getEventWithAttendance(eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return null;
  const attendanceRows = db.prepare(`
    SELECT a.*, u.name AS user_name, u.id AS user_id
    FROM attendance a JOIN users u ON u.id = a.user_id
    WHERE a.event_id = ?
  `).all(eventId);

  const attendees = attendanceRows.map(a => {
    const projects = db.prepare(`
      SELECT p.name FROM attendance_projects ap
      JOIN projects p ON p.id = ap.project_id
      WHERE ap.attendance_id = ?
    `).all(a.id).map(r => r.name);
    const meetings = db.prepare('SELECT id, text FROM meetings WHERE attendance_id = ?').all(a.id);
    const peopleToTalk = db.prepare('SELECT id, text FROM people_to_talk WHERE attendance_id = ?').all(a.id);
    const sessions = db.prepare('SELECT id, title, date, time, location FROM sessions_agenda WHERE attendance_id = ?').all(a.id);
    return {
      userId: a.user_id,
      name: a.user_name,
      attending: !!a.attending,
      attendeeTypes: getAttendeeTypes(a.id),
      projects,
      meetings,
      peopleToTalk,
      sessions,
    };
  });

  return { ...event, attendees };
}

router.get('/', (req, res) => {
  const events = db.prepare('SELECT * FROM events ORDER BY created_at DESC').all();
  const full = events.map(e => getEventWithAttendance(e.id));
  res.json(full);
});

router.get('/:id', (req, res) => {
  const ev = getEventWithAttendance(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Not found' });
  res.json(ev);
});

// Any logged-in user (staff or admin) can add an event.
router.post('/', (req, res) => {
  const { name, location, startDate, endDate, website, regFee, vendorFee, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const info = db.prepare(`
    INSERT INTO events (name, location, dates, start_date, end_date, website, reg_fee, vendor_fee, notes)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    name.trim(), location || '', '', startDate || '', endDate || '',
    website || '', regFee || 0, vendorFee || 0, notes || ''
  );
  res.json(getEventWithAttendance(info.lastInsertRowid));
});

// Any logged-in user can edit an event's core details too (this is a
// shared team tool — everyone's trusted to keep it accurate). Deleting
// stays admin-only, since that's destructive.
router.put('/:id', (req, res) => {
  const { name, location, startDate, endDate, website, regFee, vendorFee, notes } = req.body || {};
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Not found' });
  db.prepare(`
    UPDATE events SET name=?, location=?, start_date=?, end_date=?, website=?, reg_fee=?, vendor_fee=?, notes=? WHERE id=?
  `).run(
    name ?? ev.name, location ?? ev.location,
    startDate ?? ev.start_date, endDate ?? ev.end_date, website ?? ev.website,
    regFee ?? ev.reg_fee, vendorFee ?? ev.vendor_fee, notes ?? ev.notes, req.params.id
  );
  res.json(getEventWithAttendance(req.params.id));
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Current user marks themself attending/not attending + their role(s) + their own projects
router.put('/:id/attendance/me', (req, res) => {
  const eventId = req.params.id;
  const userId = req.session.userId;
  const { attending, attendeeTypes, projectNames } = req.body || {};

  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const att = ensureAttendance(eventId, userId);
  db.prepare('UPDATE attendance SET attending = ? WHERE id = ?').run(attending ? 1 : 0, att.id);

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

  res.json(getEventWithAttendance(eventId));
});

module.exports = router;
