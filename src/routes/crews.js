const express = require('express');
const { query } = require('../db/postgres');
const router = express.Router();
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query('SELECT c.id,c.name,c.specialty,c.active,n.name AS base_location FROM crews c LEFT JOIN graph_nodes n ON n.id=c.base_node_id ORDER BY c.name');
    res.json({ crews: rows });
  } catch (error) { next(error); }
});
module.exports = router;
