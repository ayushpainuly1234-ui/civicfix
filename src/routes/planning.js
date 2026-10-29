const express = require('express');
const { getMongoDb } = require('../db/mongo');
const { query } = require('../db/postgres');
const { requireAdmin } = require('../middleware/auth');
const { buildGraph, shortestPathsFrom } = require('../services/graph');
const { selectRepairsWithHoursDP, scoreIssue } = require('../services/optimizer');
const { planCrewRoute } = require('../services/routePlanner');
const { auditEvent } = require('../services/audit');
const router = express.Router();

router.post('/optimize', requireAdmin, async (req, res, next) => {
  try {
    const budget = Number(req.body.budget);
    const maxCrewHours = req.body.maxCrewHours === undefined ? 40 : Number(req.body.maxCrewHours);
    const startNodeId = String(req.body.startNodeId || 'depot');
    if (!Number.isInteger(budget) || budget < 1000 || budget > 5000000) return res.status(400).json({ error: 'Budget must be an integer between ₹1,000 and ₹5,000,000.' });
    if (!Number.isInteger(maxCrewHours) || maxCrewHours < 1 || maxCrewHours > 80) return res.status(400).json({ error: 'Crew hours must be an integer between 1 and 80.' });
    const [nodeResult, edgeResult, startResult] = await Promise.all([
      query('SELECT id,name,zone,kind,map_x,map_y FROM graph_nodes'),
      query('SELECT source_node_id,target_node_id,distance_km,is_closed FROM graph_edges'),
      query('SELECT id FROM graph_nodes WHERE id=$1', [startNodeId])
    ]);
    if (!startResult.rows.length) return res.status(400).json({ error: 'Select a valid crew start location.' });
    const graph = buildGraph(nodeResult.rows, edgeResult.rows);
    const reports = await getMongoDb().collection('reports').find({ status: { $ne: 'Resolved' } }).sort({ createdAt: -1 }).limit(100).toArray();
    // One single-source Dijkstra from the depot answers reachability for every report at once.
    const fromStart = shortestPathsFrom(graph, startNodeId).distances;
    const reachableReports = reports.filter((issue) => Number.isFinite(fromStart.get(issue.nodeId) ?? Infinity));
    const optimised = selectRepairsWithHoursDP(reachableReports, budget, maxCrewHours);
    const plannedRoute = planCrewRoute(graph, startNodeId, optimised.selected);
    const selected = plannedRoute.orderedReports.map((r) => ({ ...r, _id: String(r._id), priorityScore: scoreIssue(r) }));
    const nodesById = new Map(nodeResult.rows.map((n) => [n.id, n]));
    const routeNodes = plannedRoute.routeNodeIds.map((id) => nodesById.get(id)).filter(Boolean);
    const saved = await query(
      'INSERT INTO planning_runs (created_by,start_node_id,budget_limit,total_cost,priority_score,selected_report_ids,route_node_ids,distance_km) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING id,created_at',
      [Number(req.user.sub), startNodeId, budget, optimised.totalCost, optimised.priorityScore, JSON.stringify(selected.map((r) => r._id)), JSON.stringify(plannedRoute.routeNodeIds), plannedRoute.totalDistanceKm]
    );
    await auditEvent(req, 'planning.optimize', { resourceType: 'planning_run', resourceId: saved.rows[0].id });
    res.json({
      planId: Number(saved.rows[0].id), createdAt: saved.rows[0].created_at,
      budget, totalCost: optimised.totalCost, budgetRemaining: budget - optimised.totalCost,
      maxCrewHours, totalHours: optimised.totalHours, hoursRemaining: maxCrewHours - optimised.totalHours,
      priorityScore: optimised.priorityScore, totalDistanceKm: plannedRoute.totalDistanceKm,
      selectedReports: selected, routeNodes, legs: plannedRoute.legs,
      excludedUnreachable: reports.length - reachableReports.length,
      routeMethod: plannedRoute.method,
      note: plannedRoute.method === 'held-karp-exact'
        ? 'Repairs are selected with 0/1 knapsack DP. The visiting order is solved exactly with Held-Karp bitmask DP over Dijkstra shortest-path distances (open route, no return to depot).'
        : 'Repairs are selected with 0/1 knapsack DP. Too many stops for exact search, so the order uses a nearest-neighbour heuristic over Dijkstra distances and is not guaranteed optimal.'
    });
  } catch (error) { next(error); }
});

router.get('/history', requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.id,p.start_node_id,p.budget_limit,p.total_cost,p.priority_score,p.selected_report_ids,p.route_node_ids,p.distance_km,p.created_at,u.name AS created_by_name
       FROM planning_runs p LEFT JOIN users u ON u.id=p.created_by ORDER BY p.created_at DESC LIMIT 20`
    );
    res.json({ runs: rows });
  } catch (error) { next(error); }
});

module.exports = router;
