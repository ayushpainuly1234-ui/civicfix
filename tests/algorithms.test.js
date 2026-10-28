const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGraph, dijkstra } = require('../src/services/graph');
const { selectRepairsDP, scoreIssue } = require('../src/services/optimizer');
const { planCrewRoute } = require('../src/services/routePlanner');

test('Dijkstra picks the lowest-distance route, not the fewest edges', () => {
  const nodes = ['A','B','C','D'].map((id) => ({ id }));
  const graph = buildGraph(nodes, [
    { source_node_id:'A',target_node_id:'B',distance_km:4 },
    { source_node_id:'B',target_node_id:'D',distance_km:4 },
    { source_node_id:'A',target_node_id:'C',distance_km:2 },
    { source_node_id:'C',target_node_id:'D',distance_km:2 }
  ]);
  assert.deepEqual(dijkstra(graph, 'A', 'D'), { distance: 4, path: ['A','C','D'] });
});

test('closed road segments are excluded from the graph', () => {
  const nodes = [{ id:'A' }, { id:'B' }, { id:'C' }];
  const graph = buildGraph(nodes, [
    { source_node_id:'A',target_node_id:'B',distance_km:1,is_closed:true },
    { source_node_id:'A',target_node_id:'C',distance_km:2 },
    { source_node_id:'C',target_node_id:'B',distance_km:2 }
  ]);
  assert.deepEqual(dijkstra(graph, 'A', 'B'), { distance: 4, path: ['A','C','B'] });
});

test('Dijkstra reports a disconnected destination as unreachable', () => {
  const graph = buildGraph([{ id:'A' }, { id:'B' }], []);
  assert.deepEqual(dijkstra(graph, 'A', 'B'), { distance: Infinity, path: [] });
});

test('0/1 knapsack DP stays within budget and maximises urgency value', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  const issues = [
    { _id:'cheap-high', estimatedCost:5000, severity:5, createdAt:now },
    { _id:'medium', estimatedCost:7000, severity:4, createdAt:now },
    { _id:'too-expensive', estimatedCost:20000, severity:5, createdAt:now }
  ];
  const plan = selectRepairsDP(issues, 12000, now);
  assert.equal(plan.totalCost, 12000);
  assert.deepEqual(plan.selected.map((item) => item._id), ['cheap-high','medium']);
});

test('DP uses age as a tie-break boost, bounded to 30 days', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  assert.equal(scoreIssue({ severity:3, createdAt:new Date('2026-09-01T00:00:00Z') }, now), 330);
  assert.equal(scoreIssue({ severity:3, createdAt:now }, now), 300);
});

test('route planner uses shortest-path legs and visits reachable selected reports', () => {
  const nodes = [{ id:'A' }, { id:'B' }, { id:'C' }];
  const graph = buildGraph(nodes, [
    { source_node_id:'A',target_node_id:'B',distance_km:2 },
    { source_node_id:'B',target_node_id:'C',distance_km:1 },
    { source_node_id:'A',target_node_id:'C',distance_km:5 }
  ]);
  const plan = planCrewRoute(graph, 'A', [{ _id:'rB',nodeId:'B' }, { _id:'rC',nodeId:'C' }]);
  assert.equal(plan.orderedReports.length, 2);
  assert.deepEqual(plan.routeNodeIds, ['A','B','C']);
  assert.equal(plan.totalDistanceKm, 3);
  assert.equal(plan.unrouteableReports.length, 0);
});
