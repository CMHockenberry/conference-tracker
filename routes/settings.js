const express = require('express');
const db = require('../db/db');

const router = express.Router();

// Intentionally public (no requireAuth): the login page needs the logo and
// company name before a session exists. Nothing sensitive lives here.
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { companyName: 'Conference Ops', accentColor: '#1F6F5C', logoPath: null };
  rows.forEach(r => { s[r.key] = r.value; });
  res.json(s);
});

module.exports = router;
