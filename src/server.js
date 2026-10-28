const { port } = require('./config');
const app = require('./app');
const { connectMongo, closeMongo } = require('./db/mongo');
const { query, closePostgres } = require('./db/postgres');

async function start() {
  await connectMongo();
  await query('SELECT 1');
  const server = app.listen(port, () => console.log(`CivicFix is running at http://localhost:${port}`));
  const shutdown = async () => {
    console.log('Shutting down CivicFix...');
    server.close(async () => {
      await Promise.allSettled([closeMongo(), closePostgres()]);
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch(async (error) => {
  console.error('Could not start CivicFix:', error.message);
  // Open DB connections keep the event loop alive, so close them and exit explicitly.
  await Promise.allSettled([closeMongo(), closePostgres()]);
  process.exit(1);
});
