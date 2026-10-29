const jwt = require('jsonwebtoken');
const { jwtSecret, cookieName } = require('../config');
const { query } = require('../db/postgres');

async function optionalAuth(req, _res, next) {
  const token = req.cookies?.[cookieName];
  if (!token) return next();

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'], issuer: 'civicfix' });
  } catch {
    return next();
  }

  try {
    const { rows } = await query(
      'SELECT id,name,email,role,token_version FROM users WHERE id=$1',
      [payload.sub]
    );
    const current = rows[0];
    // A changed role or token_version immediately invalidates previously issued sessions.
    if (current && Number(payload.ver) === Number(current.token_version) && payload.role === current.role) {
      req.user = {
        ...payload,
        sub: String(current.id),
        name: current.name,
        email: current.email,
        role: current.role
      };
    }
    return next();
  } catch (error) {
    return next(error);
  }
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
