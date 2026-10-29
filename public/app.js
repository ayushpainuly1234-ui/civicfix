const $ = (selector) => document.querySelector(selector);
const state = { user: null, nodes: [], edges: [], reports: [], reportPage: 0, reportLimit: 20, reportTotal: 0, reportsHasMore: false, plan: null, filter: 'All', authMode: 'login' };
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'X-CivicFix-Request': '1', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

let toastTimer;
function toast(message, isError = false) {
  const box = $('#toast');
  box.textContent = message;
  box.classList.toggle('error', isError);
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 3400);
}
function setUser(user) {
  state.user = user;
  const userChip = $('#user-chip');
  userChip.textContent = user ? `${user.name} · ${user.role}` : '';
  userChip.classList.toggle('hidden', !user);
  $('#auth-open').classList.toggle('hidden', !!user);
  $('#logout-button').classList.toggle('hidden', !user);
  $('#report-section').classList.toggle('hidden', !user);
  $('#planner').classList.toggle('hidden', !user || user.role !== 'admin');
  $('#map-hint').textContent = user?.role === 'admin' ? 'Admin mode: click a road segment to toggle its closure.' : 'Sign in as admin to toggle road closures.';
  renderReports();
}

function openAuth(mode = 'login') {
  setAuthMode(mode);
  $('#auth-section').classList.remove('hidden');
  $('#auth-section').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#auth-form input[name="email"]').focus(), 30);
}
function closeAuth() {
  $('#auth-section').classList.add('hidden');
  $('#auth-section').setAttribute('aria-hidden', 'true');
}
function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll('[data-auth-mode]').forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode));
  $('#name-field').classList.toggle('hidden', mode !== 'register');
  $('#auth-title').textContent = mode === 'login' ? 'Join the response team.' : 'Create your account.';
  $('#auth-subtitle').textContent = mode === 'login' ? 'Sign in to submit reports and access planning tools.' : 'Create a citizen account to submit local reports.';
  $('#auth-submit').innerHTML = mode === 'login' ? 'Sign in <span>↗</span>' : 'Create account <span>↗</span>';
  $('#auth-form input[name="password"]').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-form input[name="name"]').required = mode === 'register';
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recent' : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(date);
}
function statusClass(status) {
  return status === 'Resolved' ? 'resolved' : status === 'In progress' ? 'progress' : 'open';
}
function renderMetrics(summary) {
  $('#metric-total').textContent = summary.total;
  $('#metric-open').textContent = summary.open;
  $('#metric-severe').textContent = summary.highSeverity;
  $('#metric-locations').textContent = summary.mappedLocations;
}

function renderReports() {
  const filtered = state.filter === 'All' ? state.reports : state.reports.filter((report) => report.status === state.filter);
  $('#report-count').textContent = 'SHOWING ' + filtered.length + ' OF ' + state.reportTotal + ' REPORTS';
  $('#load-more-button').classList.toggle('hidden', !state.reportsHasMore);
  if (!filtered.length) {
    $('#report-grid').innerHTML = '<div class="panel loading-state">No reports match this filter yet.</div>';
    return;
  }
  $('#report-grid').innerHTML = filtered.map((report) => {
    const severity = Number(report.severity || 1);
    const statusOptions = ['Open', 'In progress', 'Resolved'].map((status) => `<option value="${status}" ${status === report.status ? 'selected' : ''}>${status}</option>`).join('');
    return `<article class="report-card">
      <div class="report-top"><span class="category-tag">${esc(report.category)}</span><span class="status-tag ${statusClass(report.status)}">${esc(report.status)}</span></div>
      <h3>${esc(report.title)}</h3><p class="report-description">${esc(report.description)}</p>
      <div class="report-meta"><span>⌖ ${esc(report.locationName || report.node?.name || report.nodeId)}</span><span class="severity ${severity >= 4 ? 'high' : ''}"><i class="severity-mark"></i> Severity ${severity}/5</span><span>${money(report.estimatedCost)}</span><span>${formatDate(report.createdAt)}</span></div>
      ${state.user?.role === 'admin' ? `<div class="report-admin-row"><select aria-label="Update status for ${esc(report.title)}" data-status-id="${esc(report._id)}">${statusOptions}</select><button class="small-button" data-update-status="${esc(report._id)}">Save status</button></div>` : ''}
    </article>`;
  }).join('');
}

function fillNodeSelect(select, selected = '') {
  if (!select) return;
  select.innerHTML = state.nodes.map((node) => `<option value="${esc(node.id)}" ${node.id === selected ? 'selected' : ''}>${esc(node.name)} · ${esc(node.zone)}</option>`).join('');
}

function edgeKey(a, b) { return [String(a), String(b)].sort().join('|'); }
function renderMap() {
  const root = $('#network-map');
  if (!state.nodes.length) { root.innerHTML = '<div class="loading-state">Street network unavailable. Check the API connection.</div>'; return; }
  const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
  const routeIds = state.plan?.routeNodes?.map((node) => node.id) || [];
  const routeEdges = new Set();
  for (let i = 1; i < routeIds.length; i++) routeEdges.add(edgeKey(routeIds[i - 1], routeIds[i]));
  const selectedNodeIds = new Set((state.plan?.selectedReports || []).map((report) => report.nodeId));
  const edgeMarkup = state.edges.map((edge) => {
    const from = nodeById.get(edge.source_node_id), to = nodeById.get(edge.target_node_id);
    if (!from || !to) return '';
    const closed = edge.is_closed === true || edge.is_closed === 't';
    const isRoute = routeEdges.has(edgeKey(from.id, to.id));
    const midX = (Number(from.map_x) + Number(to.map_x)) / 2;
    const midY = (Number(from.map_y) + Number(to.map_y)) / 2;
    return `<g class="edge-group" data-edge-group="${edge.id}">
      <line x1="${from.map_x}" y1="${from.map_y}" x2="${to.map_x}" y2="${to.map_y}" class="edge-line ${closed ? 'closed' : ''} ${isRoute ? 'route' : ''}" />
      <line x1="${from.map_x}" y1="${from.map_y}" x2="${to.map_x}" y2="${to.map_y}" class="edge-hit" data-edge-id="${edge.id}" aria-label="Road between ${esc(from.name)} and ${esc(to.name)}" />
      <text x="${midX}" y="${midY - 7}" class="edge-label" text-anchor="middle">${Number(edge.distance_km).toFixed(1)}</text>
    </g>`;
  }).join('');
  const nodeMarkup = state.nodes.map((node) => {
    const x = Number(node.map_x), y = Number(node.map_y);
    const isRoute = routeIds.includes(node.id), isIssue = selectedNodeIds.has(node.id);
    const labelY = y < 75 ? y + 21 : y - 15;
    return `<g><circle cx="${x}" cy="${y}" r="${isIssue ? 11 : 8}" class="node-circle ${node.kind === 'facility' || node.kind === 'depot' ? 'facility' : ''} ${isRoute ? 'route-node' : ''}" />
      ${node.kind === 'depot' ? `<text x="${x + 13}" y="${y + 4}" class="node-label">${esc(node.name)}</text>` : `<text x="${x}" y="${labelY}" class="node-label" text-anchor="middle">${esc(node.name)}</text>`}
    </g>`;
  }).join('');
  root.innerHTML = `<svg viewBox="0 0 820 430" role="img" aria-label="Road network with open and closed segments, location nodes and the last planned route"><defs><pattern id="mapDots" width="17" height="17" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1" fill="#cad3df" opacity=".55"/></pattern></defs><rect x="0" y="0" width="820" height="430" rx="12" fill="#f9fbfc"/><rect x="0" y="0" width="820" height="430" fill="url(#mapDots)"/>${edgeMarkup}${nodeMarkup}</svg>`;
}

function renderPlan(plan) {
  state.plan = plan;
  renderMap();
  const selected = plan.selectedReports || [];
  const list = selected.length ? `<div class="selected-list">${selected.map((report, index) => `<div class="selected-row"><span class="selected-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${esc(report.title)}</strong><small>${esc(report.locationName || report.nodeId)} · Severity ${report.severity}/5</small></div><span class="selected-cost">${money(report.estimatedCost)}</span></div>`).join('')}</div>` : '<p class="plan-note">No open reports fit within this budget and the current reachable road network.</p>';
  const stopNames = (plan.routeNodes || []).map((node) => node.name).join(' → ');
  $('#plan-result').innerHTML = `<div class="panel-title-row"><div><span class="panel-kicker">PLAN #${plan.planId}</span><h3>Repair run proposed</h3></div><span class="pill pill-lime">DP + DIJKSTRA</span></div>
    <div class="plan-summary"><div class="plan-stat"><span>Selected cost</span><strong>${money(plan.totalCost)}</strong></div><div class="plan-stat"><span>Budget left</span><strong>${money(plan.budgetRemaining)}</strong></div><div class="plan-stat"><span>Route distance</span><strong>${Number(plan.totalDistanceKm).toFixed(1)} km</strong></div><div class="plan-stat"><span>Crew hours used</span><strong>${Number(plan.totalHours || 0)} / ${Number(plan.maxCrewHours || 0)} h</strong></div></div>
    <div class="panel-kicker">SELECTED REPAIRS (${selected.length})</div>${list}
    <div class="panel-kicker">ROUTE ORDER</div><p class="plan-note">${esc(stopNames || 'No route required')}.</p>
    <p class="plan-note">${esc(plan.note)}${plan.excludedUnreachable ? ` ${plan.excludedUnreachable} unreachable report(s) were excluded before optimisation.` : ''}</p>`;
}

async function loadReportsPage(reset = true) {
  const page = reset ? 1 : state.reportPage + 1;
  let url = '/api/reports?page=' + page + '&limit=' + state.reportLimit;
  if (state.filter !== 'All') url += '&status=' + encodeURIComponent(state.filter);
  const result = await api(url);
  state.reports = reset ? result.reports : state.reports.concat(result.reports);
  state.reportPage = result.page;
  state.reportTotal = result.total;
  state.reportsHasMore = result.hasMore;
  renderReports();
}

async function loadAll() {
  try {
    const [summary, graph] = await Promise.all([api('/api/dashboard/summary'), api('/api/graph')]);
    renderMetrics(summary);
    state.nodes = graph.nodes;
    state.edges = graph.edges;
    fillNodeSelect($('#report-location'));
    fillNodeSelect($('#planner-start'), 'depot');
    await loadReportsPage(true);
    renderMap();
  } catch (error) {
    $('#report-grid').innerHTML = '<div class="panel loading-state">Could not load the API: ' + esc(error.message) + '. Check that CivicFix server and both databases are running.</div>';
    $('#network-map').innerHTML = '<div class="loading-state">' + esc(error.message) + '</div>';
    toast(error.message, true);
  }
}

$('#auth-open').addEventListener('click', () => openAuth('login'));
$('#report-cta').addEventListener('click', () => state.user ? $('#report-section').scrollIntoView({ behavior: 'smooth' }) : openAuth('login'));
$('#auth-close').addEventListener('click', closeAuth);
$('#auth-section').addEventListener('click', (event) => { if (event.target.id === 'auth-section') closeAuth(); });
document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
$('#logout-button').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); setUser(null); state.plan = null; renderMap(); toast('Signed out.'); }
  catch (error) { toast(error.message, true); }
});
$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  const endpoint = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
  const submit = $('#auth-submit');
  submit.disabled = true; submit.textContent = 'Working…';
  try {
    const result = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    setUser(result.user); closeAuth(); event.currentTarget.reset(); await loadAll();
    toast(`Welcome, ${result.user.name}.`);
  } catch (error) { toast(error.message, true); }
  finally { submit.disabled = false; setAuthMode(state.authMode); }
});

document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
  loadReportsPage(true).catch((error) => toast(error.message, true));
}));
$('#load-more-button').addEventListener('click', async () => {
  const button = $('#load-more-button');
  button.disabled = true; button.textContent = 'Loading…';
  try { await loadReportsPage(false); }
  catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.textContent = 'Load more reports'; }
});
$('#refresh-button').addEventListener('click', loadAll);
$('#report-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  payload.severity = Number(payload.severity); payload.estimatedCost = Number(payload.estimatedCost); payload.estimatedHours = Number(payload.estimatedHours);
  const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Submitting…';
  try {
    await api('/api/reports', { method: 'POST', body: JSON.stringify(payload) });
    event.currentTarget.reset(); toast('Report submitted. Thanks for helping your community.'); await loadAll(); $('#issues').scrollIntoView({ behavior: 'smooth' });
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.innerHTML = 'Submit report <span>↗</span>'; }
});

$('#report-grid').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-update-status]');
  if (!button) return;
  const id = button.dataset.updateStatus;
  const select = $(`[data-status-id="${CSS.escape(id)}"]`);
  if (!select) return;
  button.disabled = true;
  try {
    await api(`/api/reports/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
    toast('Report status updated.'); await loadAll();
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

$('#network-map').addEventListener('click', async (event) => {
  const hit = event.target.closest('[data-edge-id]');
  if (!hit || state.user?.role !== 'admin') return;
  const edge = state.edges.find((item) => String(item.id) === hit.dataset.edgeId);
  if (!edge) return;
  try {
    const result = await api(`/api/graph/edges/${encodeURIComponent(edge.id)}/status`, { method: 'PATCH', body: JSON.stringify({ isClosed: !(edge.is_closed === true || edge.is_closed === 't') }) });
    state.edges = state.edges.map((item) => String(item.id) === String(result.edge.id) ? { ...item, ...result.edge, distance_km: Number(result.edge.distance_km) } : item);
    renderMap(); toast(result.edge.is_closed ? 'Road segment marked closed.' : 'Road segment reopened.');
  } catch (error) { toast(error.message, true); }
});

$('#planner-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries()); payload.budget = Number(payload.budget); payload.maxCrewHours = Number(payload.maxCrewHours);
  const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Optimising…';
  try {
    const result = await api('/api/planning/optimize', { method: 'POST', body: JSON.stringify(payload) });
    renderPlan(result); toast(`Plan ready: ${result.selectedReports.length} repair(s) selected.`);
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.innerHTML = 'Optimise repair plan <span>→</span>'; }
});

async function boot() {
  await loadAll();
  try { const result = await api('/api/auth/me'); setUser(result.user); }
  catch { setUser(null); }
}
boot();
