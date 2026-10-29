const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { query } = require('../db/postgres');
const { jwtSecret, cookieName, nodeEnv } = require('../config');
const { requireAuth } = require('../middleware/auth');
const { auditEvent } = require('../services/audit');

const router = express.Router();
// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equalisation-placeholder', 12);
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many authentication attempts. Try again later.' } });

function setSession(res, user) {
  const token = jwt.sign({ sub: String(user.id), role: user.role, name: user.name, email: user.email, ver: Number(user.token_version || 0) }, jwtSecret, { expiresIn: '30m', issuer: 'civicfix' });
  res.cookie(cookieName, token, { httpOnly: true, secure: nodeEnv === 'production', sameSite: 'strict', maxAge: 30 * 60 * 1000, path: '/' });
}
function publicUser(row) { return { id: Number(row.id), name: row.name, email: row.email, role: row.role }; }

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Name must be 2–100 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    // bcrypt silently ignores bytes after 72, so reject longer passwords instead of truncating them.
    if (password.length < 10 || Buffer.byteLength(password) > 72) return res.status(400).json({ error: 'Password must be 10 characters or more and at most 72 bytes.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await query('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role,token_version', [name, email, passwordHash, 'citizen']);
    setSession(res, rows[0]);
    auditEvent(req, 'auth.register', { actorId: rows[0].id, actorRole: rows[0].role });
    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    next(error);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const { rows } = await query('SELECT id,name,email,password_hash,role,token_version FROM users WHERE email=$1', [email]);
    const row = rows[0];
    const passwordOk = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !passwordOk) {
      auditEvent(req, 'auth.login.failure', { outcome: 'failure' });
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    setSession(res, row);
    auditEvent(req, 'auth.login.success', { actorId: row.id, actorRole: row.role });
    res.json({ user: publicUser(row) });
  } catch (error) { next(error); }
});

router.post('/logout', (req, res) => {
  auditEvent(req, 'auth.logout');
  res.clearCookie(cookieName, { httpOnly: true, secure: nodeEnv === 'production', sameSite: 'strict', path: '/' });
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { id: Number(req.user.sub), name: req.user.name, email: req.user.email, role: req.user.role } });
});

module.exports = router;
