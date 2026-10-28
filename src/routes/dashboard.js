const express = require('express');
const { getMongoDb } = require('../db/mongo');
const { query } = require('../db/postgres');
const router = express.Router();

router.get('/summary', async (_req, res, next) => {
  try {
    const reports = getMongoDb().collection('reports');
    const [total, open, progress, resolved, severe, nodes] = await Promise.all([
      reports.countDocuments({}), reports.countDocuments({ status: 'Open' }), reports.countDocuments({ status: 'In progress' }),
      reports.countDocuments({ status: 'Resolved' }), reports.countDocuments({ severity: { $gte: 4 }, status: { $ne: 'Resolved' } }),
      query('SELECT COUNT(*)::int AS count FROM graph_nodes')
    ]);
    res.json({ total, open, inProgress: progress, resolved, highSeverity: severe, mappedLocations: nodes.rows[0].count });
  } catch (error) { next(error); }
});

module.exports = router;
