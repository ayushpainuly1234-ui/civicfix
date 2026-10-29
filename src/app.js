const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { nodeEnv, trustProxy } = require('./config');
const { optionalAuth } = require('./middleware/auth');
const { query } = require('./db/postgres');
const { getMongoDb } = require('./db/mongo');
const authRoutes = require('./routes/auth');
const reportsRoutes = require('./routes/reports');
const dashboardRoutes = require('./routes/dashboard');
const graphRoutes = require('./routes/graph');
const crewsRoutes = require('./routes/crews');
const planningRoutes = require('./routes/planning');

const app = express();
app.disable('x-powered-by');
// Behind Render/Nginx every request shares the proxy IP, so rate limiting needs the real client IP.
if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "https://fonts.googleapis.com"], fontSrc: ["'self'", "https://fonts.gstatic.com"], scriptSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], upgradeInsecureRequests: nodeEnv === 'production' ? [] : null } } }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use((req, _res, next) => { req.requestId = randomUUID(); next(); });
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let parsedOrigin;
    try { parsedOrigin = new URL(origin); }
    catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
    if (parsedOrigin.host !== req.get('host')) {
      return res.status(403).json({ error: 'Cross-origin state changes are not allowed.' });
    }
  }
  if (req.get('x-civicfix-request') !== '1') {
    return res.status(403).json({ error: 'Missing same-origin request header.' });
  }
  next();
});
app.use(optionalAuth);
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/graph', graphRoutes);
app.use('/api/crews', crewsRoutes);
app.use('/api/planning', planningRoutes);
app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    await getMongoDb().command({ ping: 1 });
    res.json({ status: 'ok', service: 'civicfix-api', dependencies: 'ready' });
  } catch {
    res.status(503).json({ status: 'error', service: 'civicfix-api', dependencies: 'unavailable' });
  }
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { etag: true, maxAge: nodeEnv === 'production' ? 0 : '1h' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  const status = Number(err.status || err.statusCode || 500);
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: status >= 500 ? 'Unexpected server error. Check server logs.' : err.message });
});

module.exports = app;
