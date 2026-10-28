const { shortestPathsFrom, pathTo } = require('./graph');

// Up to this many stops the visiting order is solved EXACTLY with Held-Karp bitmask DP:
// O(2^k * k^2) time, O(2^k * k) memory. 12 stops = ~590k transitions, i.e. instant.
const EXACT_LIMIT = 12;

function heldKarpOrder(startId, stops, dist) {
  const n = stops.length;
  if (n === 0) return [];
  const d = stops.map((a) => stops.map((b) => dist(a.nodeId, b.nodeId)));
  const full = 1 << n;
  const dp = Array.from({ length: full }, () => new Float64Array(n).fill(Infinity));
  const parent = Array.from({ length: full }, () => new Int8Array(n).fill(-1));
  for (let i = 0; i < n; i++) dp[1 << i][i] = dist(startId, stops[i].nodeId);

  for (let mask = 1; mask < full; mask++) {
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue;
      const current = dp[mask][last];
      if (!Number.isFinite(current)) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nextMask = mask | (1 << next);
        const candidate = current + d[last][next];
        if (candidate < dp[nextMask][next]) {
          dp[nextMask][next] = candidate;
          parent[nextMask][next] = last;
        }
      }
    }
  }
  // Open path: the crew does not have to return to the depot, so take the best final stop.
  let last = 0;
  for (let i = 1; i < n; i++) if (dp[full - 1][i] < dp[full - 1][last]) last = i;
  const order = [];
  let mask = full - 1;
  while (last !== -1) {
    order.push(last);
    const prev = parent[mask][last];
    mask ^= 1 << last;
    last = prev;
  }
  return order.reverse().map((i) => stops[i]);
}

function nearestNeighbourOrder(startId, stops, dist) {
  const remaining = [...stops];
  const order = [];
  let current = startId;
  while (remaining.length) {
    let best = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (dist(current, remaining[i].nodeId) < dist(current, remaining[best].nodeId)) best = i;
    }
    const [next] = remaining.splice(best, 1);
    order.push(next);
    current = next.nodeId;
  }
  return order;
}

// Orders the selected repair stops and expands every leg into a real road path.
// Shortest-path trees are computed once per distinct source (k + 1 Dijkstra runs), not once per pair/step.
function planCrewRoute(graph, startNodeId, reports, { exactLimit = EXACT_LIMIT } = {}) {
  const trees = new Map();
  const tree = (id) => { if (!trees.has(id)) trees.set(id, shortestPathsFrom(graph, id)); return trees.get(id); };
  const dist = (a, b) => tree(a).distances.get(b) ?? Infinity;

  const stops = [];
  const unrouteableReports = [];
  for (const report of reports) {
    const copy = { ...report };
    (Number.isFinite(dist(startNodeId, report.nodeId)) ? stops : unrouteableReports).push(copy);
  }

  const exact = stops.length <= exactLimit;
  const orderedReports = exact ? heldKarpOrder(startNodeId, stops, dist) : nearestNeighbourOrder(startNodeId, stops, dist);

  const routeNodeIds = [startNodeId];
  const legs = [];
  let totalDistanceKm = 0;
  let current = startNodeId;
  for (const report of orderedReports) {
    const leg = pathTo(tree(current), report.nodeId);
    legs.push({ reportId: String(report._id), distanceKm: Number(leg.distance.toFixed(3)), path: leg.path });
    totalDistanceKm += leg.distance;
    routeNodeIds.push(...leg.path.slice(1));
    current = report.nodeId;
  }
  return {
    orderedReports, routeNodeIds, legs, unrouteableReports,
    totalDistanceKm: Number(totalDistanceKm.toFixed(3)),
    method: exact ? 'held-karp-exact' : 'nearest-neighbour-heuristic'
  };
}

module.exports = { planCrewRoute, EXACT_LIMIT };
