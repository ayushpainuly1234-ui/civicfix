require('dotenv').config();

const required = ['JWT_SECRET', 'MONGO_URI', 'DATABASE_URL'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env first.`);
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

const isProduction = process.env.NODE_ENV === 'production';
const demoAdminPassword = 'CivicFixDemo!2026';
if (/^replace-this/i.test(process.env.JWT_SECRET)) {
  if (isProduction) throw new Error('JWT_SECRET is still the .env.example placeholder. Generate a random secret.');
  console.warn('WARNING: JWT_SECRET is the example placeholder. Fine for local demo only.');
}
if (isProduction && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === demoAdminPassword)) {
  throw new Error('Set a unique ADMIN_PASSWORD in production; the demo password is public.');
}

module.exports = {
  trustProxy: process.env.TRUST_PROXY || '',
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET,
  mongoUri: process.env.MONGO_URI,
  mongoDb: process.env.MONGO_DB || 'civicfix',
  databaseUrl: process.env.DATABASE_URL,
  cookieName: process.env.COOKIE_NAME || 'civicfix_session',
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@civicfix.local').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || demoAdminPassword,
  nodeEnv: process.env.NODE_ENV || 'development'
};
