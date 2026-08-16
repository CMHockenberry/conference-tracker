const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { ensureAttendance, getFullAttendance, updateAttendanceFields } = require('../db/attendanceHelpers');

const router = express.Router();
router.use(requireAuth);

// All events the current user is marked attending, with full travel detail
router.get('/travel', (req, res) => {
  const userId = req.session.userId;
  const eventIds = db.prepare(`
    SELECT e.id FROM events e
    JOIN attendance a ON a.event_id = e.id
    WHERE a.user_id = ? AND a.attending = 1
    ORDER BY e.created_at DESC
  `).all(userId).map(r => r.id);
  res.json(eventIds.map(id => getFullAttendance(id, userId)));
});

router.put('/travel/:eventId', (req, res) => {
  const userId = req.session.userId;
  const att = ensureAttendance(req.params.eventId, userId);
  updateAttendanceFields(att.id, req.body || {});
  res.json(getFullAttendance(req.params.eventId, userId));
});

router.post('/travel/:eventId/meetings', (req, res) => {
  const att = ensureAttendance(req.params.eventId, req.session.userId);
  db.prepare('INSERT INTO meetings (attendance_id, text) VALUES (?, ?)').run(att.id, req.body.text || '');
  res.json(getFullAttendance(req.params.eventId, req.session.userId));
});
router.put('/meetings/:id', (req, res) => {
  db.prepare('UPDATE meetings SET text = ? WHERE id = ?').run(req.body.text || '', req.params.id);
  res.json({ ok: true });
});
router.delete('/meetings/:id', (req, res) => {
  db.prepare('DELETE FROM meetings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/travel/:eventId/people', (req, res) => {
  const att = ensureAttendance(req.params.eventId, req.session.userId);
  db.prepare('INSERT INTO people_to_talk (attendance_id, text) VALUES (?, ?)').run(att.id, req.body.text || '');
  res.json(getFullAttendance(req.params.eventId, req.session.userId));
});
router.put('/people/:id', (req, res) => {
  db.prepare('UPDATE people_to_talk SET text = ? WHERE id = ?').run(req.body.text || '', req.params.id);
  res.json({ ok: true });
});
router.delete('/people/:id', (req, res) => {
  db.prepare('DELETE FROM people_to_talk WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/travel/:eventId/sessions', (req, res) => {
  const att = ensureAttendance(req.params.eventId, req.session.userId);
  db.prepare('INSERT INTO sessions_agenda (attendance_id, title, date, time, location) VALUES (?,?,?,?,?)')
    .run(att.id, '', '', '', '');
  res.json(getFullAttendance(req.params.eventId, req.session.userId));
});
router.put('/sessions/:id', (req, res) => {
  const { title, date, time, location } = req.body || {};
  const s = db.prepare('SELECT * FROM sessions_agenda WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE sessions_agenda SET title=?, date=?, time=?, location=? WHERE id=?')
    .run(title ?? s.title, date ?? s.date, time ?? s.time, location ?? s.location, req.params.id);
  res.json({ ok: true });
});
router.delete('/sessions/:id', (req, res) => {
  db.prepare('DELETE FROM sessions_agenda WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
