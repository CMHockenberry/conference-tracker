const express = require('express');
const db = require('../db/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM projects ORDER BY name').all());
});

router.post('/', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    db.prepare('INSERT INTO projects (name) VALUES (?)').run(name);
  } catch (e) {
    return res.status(400).json({ error: 'Project already exists' });
  }
  res.json(db.prepare('SELECT * FROM projects ORDER BY name').all());
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json(db.prepare('SELECT * FROM projects ORDER BY name').all());
});

module.exports = router;
