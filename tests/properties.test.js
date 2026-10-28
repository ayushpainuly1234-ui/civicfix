const test = require('node:test');
const assert = require('node:assert/strict');
const { MinPriorityQueue, buildGraph, dijkstra } = require('../src/services/graph');
const { selectRepairsDP, scoreIssue } = require('../src/services/optimizer');
const { planCrewRoute } = require('../src/services/routePlanner');

// Seeded PRNG (mulberry32) so a failing random case is reproducible, never flaky.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// Random connected graph: a random spanning tree plus extra edges, distances rounded to 3 decimals.
function randomGraph(rand, n) {
  const ids = Array.from({ length: n }, (_, i) => `n${i}`);
  const edges = [];
  const weight = () => Math.round((0.1 + rand() * 3) * 1000) / 1000;
  for (let i = 1; i < n; i++) edges.push({ source_node_id: ids[randInt(rand, 0, i - 1)], target_node_id: ids[i], distance_km: weight() });
  for (let e = 0; e < n; e++) {
    const a = randInt(rand, 0, n - 1), b = randInt(rand, 0, n - 1);
    if (a !== b) edges.push({ source_node_id: ids[a], target_node_id: ids[b], distance_km: weight() });
  }
  return { ids, edges, graph: buildGraph(ids.map((id) => ({ id })), edges) };
}

function floydWarshall(ids, edges) {
  const d = Object.fromEntries(ids.map((a) => [a, Object.fromEntries(ids.map((b) => [b, a === b ? 0 : Infinity]))]));
  for (const e of edges) {
    d[e.source_node_id][e.target_node_id] = Math.min(d[e.source_node_id][e.target_node_id], e.distance_km);
    d[e.target_node_id][e.source_node_id] = Math.min(d[e.target_node_id][e.source_node_id], e.distance_km);
  }
  for (const k of ids) for (const i of ids) for (const j of ids) if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
  return d;
}

function* permutations(items) {
  if (items.length <= 1) { yield items; return; }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i], ...p];
  }
}

test('min-heap pops values in sorted order for random input', () => {
  const rand = rng(1);
  const heap = new MinPriorityQueue();
  const values = Array.from({ length: 500 }, () => randInt(rand, 0, 1000));
  values.forEach((priority) => heap.push({ priority }));
  const popped = [];
  while (heap.size) popped.push(heap.pop().priority);
  assert.deepEqual(popped, [...values].sort((a, b) => a - b));
});

test('Dijkstra distances match Floyd-Warshall on 40 random graphs', () => {
  const rand = rng(2);
  for (let round = 0; round < 40; round++) {
    const { ids, edges, graph } = randomGraph(rand, randInt(rand, 3, 10));
    const truth = floydWarshall(ids, edges);
    for (const a of ids) for (const b of ids) {
      assert.ok(Math.abs(dijkstra(graph, a, b).distance - truth[a][b]) < 1e-9, `round ${round}: ${a}->${b}`);
    }
  }
});

test('knapsack DP value equals brute-force optimum on 60 random instances', () => {
  const rand = rng(3);
  const now = new Date('2026-10-28T00:00:00Z');
  for (let round = 0; round < 60; round++) {
    const n = randInt(rand, 1, 10);
    const issues = Array.from({ length: n }, (_, i) => ({
      _id: `r${i}`,
      estimatedCost: randInt(rand, 1000, 30000),
      severity: randInt(rand, 1, 5),
      createdAt: new Date(now - randInt(rand, 0, 40) * 86_400_000)
    }));
    const budget = randInt(rand, 0, 60) * 1000 + randInt(rand, 0, 999);
    const capacity = Math.floor(budget / 1000);
    let best = 0;
    for (let mask = 0; mask < 1 << n; mask++) {
      let weight = 0, value = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) { weight += Math.ceil(issues[i].estimatedCost / 1000); value += scoreIssue(issues[i], now); }
      if (weight <= capacity) best = Math.max(best, value);
    }
    const plan = selectRepairsDP(issues, budget, now);
    assert.equal(plan.priorityScore, best, `round ${round}`);
    assert.ok(plan.totalCost <= budget, `round ${round}: stays within budget`);
    assert.equal(new Set(plan.selected.map((i) => i._id)).size, plan.selected.length, 'no issue selected twice');
  }
});

test('Held-Karp route order matches brute-force over all permutations', () => {
  const rand = rng(4);
  for (let round = 0; round < 25; round++) {
    const { ids, edges, graph } = randomGraph(rand, randInt(rand, 4, 9));
    const truth = floydWarshall(ids, edges);
    const k = randInt(rand, 1, Math.min(6, ids.length - 1));
    const reports = Array.from({ length: k }, (_, i) => ({ _id: `r${i}`, nodeId: ids[randInt(rand, 1, ids.length - 1)] }));
    let best = Infinity;
    for (const order of permutations(reports)) {
      let total = truth[ids[0]][order[0].nodeId];
      for (let i = 1; i < order.length; i++) total += truth[order[i - 1].nodeId][order[i].nodeId];
      best = Math.min(best, total);
    }
    const plan = planCrewRoute(graph, ids[0], reports);
    assert.equal(plan.method, 'held-karp-exact');
    assert.equal(plan.orderedReports.length, k);
    assert.ok(Math.abs(plan.totalDistanceKm - best) < 0.0015, `round ${round}: planner ${plan.totalDistanceKm} vs optimum ${best}`);
  }
});

test('exact route is never longer than the nearest-neighbour heuristic', () => {
  const rand = rng(5);
  for (let round = 0; round < 25; round++) {
    const { ids, graph } = randomGraph(rand, randInt(rand, 6, 12));
    const reports = Array.from({ length: randInt(rand, 3, 7) }, (_, i) => ({ _id: `r${i}`, nodeId: ids[randInt(rand, 1, ids.length - 1)] }));
    const exact = planCrewRoute(graph, ids[0], reports);
    const greedy = planCrewRoute(graph, ids[0], reports, { exactLimit: 0 });
    assert.equal(greedy.method, 'nearest-neighbour-heuristic');
    assert.ok(exact.totalDistanceKm <= greedy.totalDistanceKm + 0.0015, `round ${round}`);
  }
});

test('route planner separates unreachable reports and handles several reports at one node', () => {
  const graph = buildGraph([{ id: 'A' }, { id: 'B' }, { id: 'island' }], [{ source_node_id: 'A', target_node_id: 'B', distance_km: 2 }]);
  const plan = planCrewRoute(graph, 'A', [{ _id: 'r1', nodeId: 'B' }, { _id: 'r2', nodeId: 'B' }, { _id: 'lost', nodeId: 'island' }]);
  assert.deepEqual(plan.unrouteableReports.map((r) => r._id), ['lost']);
  assert.equal(plan.orderedReports.length, 2);
  assert.equal(plan.totalDistanceKm, 2);
  assert.deepEqual(plan.routeNodeIds, ['A', 'B']);
});

test('route planner returns an empty plan when nothing is selected', () => {
  const graph = buildGraph([{ id: 'A' }], []);
  const plan = planCrewRoute(graph, 'A', []);
  assert.deepEqual(plan.routeNodeIds, ['A']);
  assert.equal(plan.totalDistanceKm, 0);
});
