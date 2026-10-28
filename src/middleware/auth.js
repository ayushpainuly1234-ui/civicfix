const jwt = require('jsonwebtoken');
const { jwtSecret, cookieName } = require('../config');

function optionalAuth(req, _res, next) {
  const token = req.cookies?.[cookieName];
  if (token) {
    try { req.user = jwt.verify(token, jwtSecret, { algorithms: ['HS256'], issuer: 'civicfix' }); } catch { /* An expired session is treated as signed out. */ }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access is required for this action.' });
  next();
}

module.exports = { optionalAuth, requireAuth, requireAdmin };
