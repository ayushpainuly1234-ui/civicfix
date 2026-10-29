'use strict';

const DEFAULT_BASE_URL = 'https://civicfix-7q99.onrender.com';
const baseInput = process.env.CIVICFIX_BASE_URL || DEFAULT_BASE_URL;
let baseUrl;

try {
  const parsed = new URL(baseInput);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Use an http(s) base URL without credentials, query parameters or fragments.');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  baseUrl = parsed.toString().replace(/\/+$/, '');
} catch (error) {
  console.error('Invalid CIVICFIX_BASE_URL:', error.message);
  process.exit(2);
}

const HEALTH_WAIT_MS = Number(process.env.CIVICFIX_HEALTH_WAIT_MS || 120_000);
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 5_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function get(path) {
  return fetch(baseUrl + path, {
    method: 'GET',
    headers: { accept: 'application/json, text/html;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
}

async function parseJson(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(label + ' returned non-JSON content (HTTP ' + response.status + ').');
  }
}

async function checkHealth() {
  const deadline = Date.now() + HEALTH_WAIT_MS;
  let lastObservation = 'No response yet';
  while (Date.now() <= deadline) {
    try {
      const response = await get('/api/health');
      const contentType = response.headers.get('content-type') || '';
      if (response.status === 200 && contentType.includes('application/json')) {
        const body = await parseJson(response, '/api/health');
        if (body.status === 'ok' && body.dependencies === 'ready') {
          console.log('PASS /api/health: API and database dependencies are ready.');
          return;
        }
        lastObservation = 'HTTP 200 but health payload is not ready';
      } else {
        lastObservation = 'HTTP ' + response.status + (contentType.includes('text/html') ? ' with HTML response' : '');
      }
    } catch (error) {
      lastObservation = error.name + ': ' + error.message;
    }
    if (Date.now() >= deadline) break;
    console.log('Waiting for the hosted service to become healthy; last observation: ' + lastObservation);
    await delay(Math.min(RETRY_DELAY_MS, Math.max(0, deadline - Date.now())));
  }
  throw new Error('Health check did not become ready within ' + HEALTH_WAIT_MS + ' ms. Last observation: ' + lastObservation);
}

async function checkHomepage() {
  const response = await get('/');
  const html = await response.text();
  if (response.status !== 200 || !/<title>\s*CivicFix\b/i.test(html) || !html.includes('/app.js')) {
    throw new Error('Homepage smoke check failed (HTTP ' + response.status + ' or unexpected HTML).');
  }
  console.log('PASS /: CivicFix HTML and frontend script reference returned.');
}

async function checkGraph() {
  const response = await get('/api/graph');
  if (response.status !== 200) throw new Error('/api/graph returned HTTP ' + response.status + '.');
  const body = await parseJson(response, '/api/graph');
  if (!Array.isArray(body.nodes) || body.nodes.length < 1 || !Array.isArray(body.edges) || body.edges.length < 1) {
    throw new Error('/api/graph response is missing nodes or edges.');
  }
  console.log('PASS /api/graph: ' + body.nodes.length + ' nodes and ' + body.edges.length + ' edges returned.');
}

async function checkReports() {
  const response = await get('/api/reports?page=1&limit=1');
  if (response.status !== 200) throw new Error('/api/reports returned HTTP ' + response.status + '.');
  const body = await parseJson(response, '/api/reports');
  if (!Array.isArray(body.reports) || body.reports.length > 1 || body.page !== 1 || body.limit !== 1 ||
      !Number.isInteger(body.total) || typeof body.hasMore !== 'boolean') {
    throw new Error('/api/reports response does not satisfy the pagination contract.');
  }
  console.log('PASS /api/reports: one-item page and pagination metadata returned (total=' + body.total + ').');
}

async function main() {
  console.log('Checking CivicFix deployment: ' + baseUrl);
  await checkHealth();
  await checkHomepage();
  await checkGraph();
  await checkReports();
  console.log('SMOKE CHECK PASSED: all public-read checks succeeded.');
}

main().catch((error) => {
  console.error('SMOKE CHECK FAILED:', error.message);
  process.exitCode = 1;
});
