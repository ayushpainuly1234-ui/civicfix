const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ObjectId } = require('mongodb');

const enabled = process.env.RUN_DB_INTEGRATION === '1'
  && Boolean(process.env.DATABASE_URL && process.env.MONGO_URI && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD);

test('CivicFix API end-to-end against PostgreSQL and MongoDB', { skip: !enabled }, async (t) => {
  const { connectMongo, getMongoDb, closeMongo } = require('../src/db/mongo');
  const { query, closePostgres } = require('../src/db/postgres');
  const app = require('../src/app');
  await connectMongo();
  await query('SELECT 1');

  const server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const base = 'http://127.0.0.1:' + address.port;
  const email = 'integration-' + randomUUID() + '@example.test';
  const password = 'E2E-' + randomUUID() + '-only!';
  let userId = null;
  let reportId = null;
  let citizenCookie = null;
  let adminCookie = null;

  async function call(path, options = {}) {
    const method = options.method || 'GET';
    const headers = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      if (options.csrf !== false) headers['x-civicfix-request'] = '1';
      if (options.origin !== null) headers.origin = options.origin || base;
    }
    if (options.cookie) headers.cookie = options.cookie;
    const response = await fetch(base + path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    let body = null;
    try { body = await response.json(); } catch {}
    const setCookie = response.headers.get('set-cookie');
    return { response, body, cookie: setCookie ? setCookie.split(';')[0] : null };
  }

  try {
    await t.test('health and database-backed read APIs work', async () => {
      const health = await call('/api/health');
      assert.equal(health.response.status, 200);
      assert.equal(health.body.status, 'ok');
      const summary = await call('/api/dashboard/summary');
      assert.equal(summary.response.status, 200);
      assert.ok(summary.body.mappedLocations >= 10);
      const page1 = await call('/api/reports?page=1&limit=2');
      assert.equal(page1.response.status, 200);
      assert.equal(page1.body.reports.length, 2);
      assert.ok(page1.body.total >= 8);
      assert.equal(page1.body.hasMore, true);
      const page2 = await call('/api/reports?page=2&limit=2');
      assert.equal(page2.response.status, 200);
      assert.equal(page2.body.reports.length, 2);
      assert.ok(!page1.body.reports.some((a) => page2.body.reports.some((b) => a._id === b._id)));
    });

    await t.test('unsafe requests require a same-origin header', async () => {
      const blockedHeader = await call('/api/auth/register', {
        method: 'POST', csrf: false,
        body: { name: 'Integration User', email, password }
      });
      assert.equal(blockedHeader.response.status, 403);
      const blockedOrigin = await call('/api/auth/register', {
        method: 'POST', origin: 'https://attacker.example',
        body: { name: 'Integration User', email, password }
      });
      assert.equal(blockedOrigin.response.status, 403);
    });

    await t.test('registration, duplicate detection, login and session identity work', async () => {
      const register = await call('/api/auth/register', {
        method: 'POST', body: { name: 'Integration User', email, password }
      });
      assert.equal(register.response.status, 201, JSON.stringify(register.body));
      assert.equal(register.body.user.role, 'citizen');
      assert.ok(register.cookie);
      citizenCookie = register.cookie;
      userId = register.body.user.id;

      const duplicate = await call('/api/auth/register', {
        method: 'POST', body: { name: 'Integration User', email: email.toUpperCase(), password }
      });
      assert.equal(duplicate.response.status, 409);

      const wrongPassword = await call('/api/auth/login', {
        method: 'POST', body: { email, password: randomUUID() }
      });
      assert.equal(wrongPassword.response.status, 401);

      const login = await call('/api/auth/login', {
        method: 'POST', body: { email: email.toUpperCase(), password }
      });
      assert.equal(login.response.status, 200);
      assert.equal(login.body.user.email, email);
      citizenCookie = login.cookie;
      const me = await call('/api/auth/me', { cookie: citizenCookie });
      assert.equal(me.response.status, 200);
      assert.equal(me.body.user.id, userId);
    });

    await t.test('citizen report creation persists in MongoDB and admin-only actions are blocked', async () => {
      const unauthenticated = await call('/api/reports', {
        method: 'POST',
        body: { title: 'Anonymous test report', description: 'This report must not be accepted.', category: 'Road damage', nodeId: 'depot', severity: 2, estimatedCost: 5000, estimatedHours: 2 }
      });
      assert.equal(unauthenticated.response.status, 401);

      const title = 'E2E test report ' + randomUUID();
      const created = await call('/api/reports', {
        method: 'POST', cookie: citizenCookie,
        body: { title, description: 'A durable integration test report for database persistence.', category: 'Road damage', nodeId: 'central-square', severity: 4, estimatedCost: 5000, estimatedHours: 2 }
      });
      assert.equal(created.response.status, 201, JSON.stringify(created.body));
      reportId = created.body.report._id;
      assert.ok(await getMongoDb().collection('reports').findOne({ _id: new ObjectId(reportId), title }));
      const listed = await call('/api/reports?page=1&limit=50');
      assert.ok(listed.body.reports.some((report) => report._id === reportId));

      const forbiddenStatus = await call('/api/reports/' + reportId + '/status', {
        method: 'PATCH', cookie: citizenCookie, body: { status: 'Resolved' }
      });
      assert.equal(forbiddenStatus.response.status, 403);
      const forbiddenPlanner = await call('/api/planning/optimize', {
        method: 'POST', cookie: citizenCookie, body: { budget: 60000, maxCrewHours: 40, startNodeId: 'depot' }
      });
      assert.equal(forbiddenPlanner.response.status, 403);
    });

    await t.test('admin can change road/report status and persist a repair plan', async () => {
      const login = await call('/api/auth/login', {
        method: 'POST',
        body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }
      });
      assert.equal(login.response.status, 200, JSON.stringify(login.body));
      assert.equal(login.body.user.role, 'admin');
      adminCookie = login.cookie;

      const graph = await call('/api/graph');
      assert.equal(graph.response.status, 200);
      const edge = graph.body.edges[0];
      const previous = Boolean(edge.is_closed);
      const updateEdge = await call('/api/graph/edges/' + edge.id + '/status', {
        method: 'PATCH', cookie: adminCookie, body: { isClosed: !previous }
      });
      assert.equal(updateEdge.response.status, 200);
      assert.equal(Boolean(updateEdge.body.edge.is_closed), !previous);
      const restoreEdge = await call('/api/graph/edges/' + edge.id + '/status', {
        method: 'PATCH', cookie: adminCookie, body: { isClosed: previous }
      });
      assert.equal(restoreEdge.response.status, 200);

      const status = await call('/api/reports/' + reportId + '/status', {
        method: 'PATCH', cookie: adminCookie, body: { status: 'In progress' }
      });
      assert.equal(status.response.status, 200, JSON.stringify(status.body));
      const inProgress = await call('/api/reports?status=In%20progress&page=1&limit=50');
      assert.ok(inProgress.body.reports.some((report) => report._id === reportId));

      const plan = await call('/api/planning/optimize', {
        method: 'POST', cookie: adminCookie,
        body: { budget: 60000, startNodeId: 'depot' }
      });
      assert.equal(plan.response.status, 200, JSON.stringify(plan.body));
      assert.ok(plan.body.planId);
      assert.ok(plan.body.totalCost <= plan.body.budget);
      assert.ok(plan.body.totalHours <= plan.body.maxCrewHours);
      assert.ok(Array.isArray(plan.body.selectedReports));
      assert.ok(['held-karp-exact', 'nearest-neighbour-heuristic'].includes(plan.body.routeMethod));
      const history = await call('/api/planning/history', { cookie: adminCookie });
      assert.equal(history.response.status, 200);
      assert.ok(history.body.runs.some((run) => Number(run.id) === plan.body.planId));
    });

    await t.test('incrementing token_version revokes existing sessions', async () => {
      await query('UPDATE users SET token_version=token_version+1 WHERE id=$1', [userId]);
      const revoked = await call('/api/auth/me', { cookie: citizenCookie });
      assert.equal(revoked.response.status, 401);
    });
  } finally {
    if (reportId) await getMongoDb().collection('reports').deleteOne({ _id: new ObjectId(reportId) }).catch(() => {});
    if (userId) {
      await query('DELETE FROM planning_runs WHERE created_by=$1', [userId]).catch(() => {});
      await query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
    }
    await new Promise((resolve) => server.close(resolve));
    await Promise.allSettled([closeMongo(), closePostgres()]);
  }
});
