const db = require('./db');

function ensureAttendance(eventId, userId) {
  let att = db.prepare('SELECT * FROM attendance WHERE event_id = ? AND user_id = ?').get(eventId, userId);
  if (!att) {
    const info = db.prepare('INSERT INTO attendance (event_id, user_id, attending) VALUES (?,?,0)').run(eventId, userId);
    att = db.prepare('SELECT * FROM attendance WHERE id = ?').get(info.lastInsertRowid);
  }
  return att;
}

function getAttendeeTypes(attendanceId) {
  return db.prepare('SELECT type FROM attendance_types WHERE attendance_id = ?').all(attendanceId).map(r => r.type);
}

// Multi-select: replace the full set of attendee types (vendor/attendee/speaker) for one attendance row.
function setAttendeeTypes(attendanceId, types) {
  db.prepare('DELETE FROM attendance_types WHERE attendance_id = ?').run(attendanceId);
  const insert = db.prepare('INSERT OR IGNORE INTO attendance_types (attendance_id, type) VALUES (?, ?)');
  for (const t of (types || [])) {
    if (t) insert.run(attendanceId, t);
  }
}

function getFullAttendance(eventId, userId) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return null;
  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
  const att = ensureAttendance(eventId, userId);

  const projects = db.prepare(`
    SELECT p.name FROM attendance_projects ap JOIN projects p ON p.id = ap.project_id
    WHERE ap.attendance_id = ?
  `).all(att.id).map(r => r.name);

  const meetings = db.prepare('SELECT id, text FROM meetings WHERE attendance_id = ?').all(att.id);
  const peopleToTalk = db.prepare('SELECT id, text FROM people_to_talk WHERE attendance_id = ?').all(att.id);
  const sessions = db.prepare('SELECT id, title, date, time, location FROM sessions_agenda WHERE attendance_id = ?').all(att.id);

  return {
    eventId: event.id,
    eventName: event.name,
    eventLocation: event.location,
    eventDates: event.dates,
    eventStartDate: event.start_date,
    eventEndDate: event.end_date,
    userId: user ? user.id : userId,
    userName: user ? user.name : '',
    attendanceId: att.id,
    attending: !!att.attending,
    attendeeTypes: getAttendeeTypes(att.id),
    projects,
    registered: !!att.registered,
    accommodationsBooked: !!att.accommodations_booked,
    hotelName: att.hotel_name,
    hotelAddress: att.hotel_address,
    transportationBooked: !!att.transportation_booked,
    flightInfo: att.flight_info,
    rentalCarInfo: att.rental_car_info,
    trainInfo: att.train_info,
    meetings,
    peopleToTalk,
    sessions,
  };
}

function updateAttendanceFields(attendanceId, fields) {
  const map = {
    registered: 'registered',
    accommodationsBooked: 'accommodations_booked',
    hotelName: 'hotel_name',
    hotelAddress: 'hotel_address',
    transportationBooked: 'transportation_booked',
    flightInfo: 'flight_info',
    rentalCarInfo: 'rental_car_info',
    trainInfo: 'train_info',
  };
  const sets = [];
  const vals = [];
  for (const key of Object.keys(fields)) {
    if (!(key in map)) continue;
    sets.push(`${map[key]} = ?`);
    let v = fields[key];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    vals.push(v);
  }
  if (sets.length === 0) return;
  vals.push(attendanceId);
  db.prepare(`UPDATE attendance SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

module.exports = { ensureAttendance, getFullAttendance, updateAttendanceFields, getAttendeeTypes, setAttendeeTypes };
