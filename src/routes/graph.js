const express = require('express');
const { query } = require('../db/postgres');
const { auditEvent } = require('../services/audit');
const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const [nodes, edges] = await Promise.all([
      query('SELECT id,name,zone,kind,map_x,map_y FROM graph_nodes ORDER BY id'),
      query('SELECT id,source_node_id,target_node_id,distance_km,is_closed FROM graph_edges ORDER BY id')
    ]);
    res.json({ nodes: nodes.rows, edges: edges.rows.map((edge) => ({ ...edge, distance_km: Number(edge.distance_km) })) });
  } catch (error) { next(error); }
});

router.patch('/edges/:id/status', require('../middleware/auth').requireAdmin, async (req, res, next) => {
  try {
    const edgeId = Number(req.params.id);
    if (!Number.isSafeInteger(edgeId) || edgeId <= 0) return res.status(400).json({ error: 'Invalid road ID.' });
    if (typeof req.body.isClosed !== 'boolean') return res.status(400).json({ error: 'isClosed must be true or false.' });
    const result = await query('UPDATE graph_edges SET is_closed=$1 WHERE id=$2 RETURNING id,source_node_id,target_node_id,distance_km,is_closed', [req.body.isClosed, edgeId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Road segment not found.' });
    await auditEvent(req, 'road.status.update', { resourceType: 'edge', resourceId: edgeId });
    res.json({ edge: result.rows[0] });
  } catch (error) { next(error); }
});

module.exports = router;
