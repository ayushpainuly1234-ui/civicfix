const express = require('express');
const { ObjectId } = require('mongodb');
const { getMongoDb } = require('../db/mongo');
const { query } = require('../db/postgres');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { auditEvent } = require('../services/audit');
const router = express.Router();
const categories = new Set(['Road damage', 'Streetlight', 'Waste', 'Water leak', 'Accessibility', 'Other']);

router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    if (status && !['Open', 'In progress', 'Resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid report status filter.' });
    }
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return res.status(400).json({ error: 'Page size must be an integer between 1 and 50.' });
    }
    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      return res.status(400).json({ error: 'Page must be an integer between 1 and 10000.' });
    }
    const filter = status ? { status } : {};
    const collection = getMongoDb().collection('reports');
    const [total, docs] = await Promise.all([
      collection.countDocuments(filter),
      collection.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray()
    ]);
    const names = await query('SELECT id,name,zone FROM graph_nodes');
    const nodeLookup = new Map(names.rows.map((n) => [n.id, n]));
    const isAdmin = req.user?.role === 'admin';
    res.json({
      reports: docs.map(({ createdBy, ...d }) => ({
        ...d, ...(isAdmin ? { createdBy } : {}), _id: String(d._id),
        node: nodeLookup.get(d.nodeId) || null
      })),
      page, limit, total, hasMore: page * limit < total
    });
  } catch (error) { next(error); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const category = String(req.body.category || 'Other');
    const nodeId = String(req.body.nodeId || '');
    const severity = Number(req.body.severity);
    const estimatedCost = Number(req.body.estimatedCost);
    const estimatedHours = Number(req.body.estimatedHours);
    if (title.length < 5 || title.length > 120) return res.status(400).json({ error: 'Title must be 5–120 characters.' });
    if (description.length < 10 || description.length > 1000) return res.status(400).json({ error: 'Description must be 10–1,000 characters.' });
    if (!categories.has(category)) return res.status(400).json({ error: 'Choose a supported issue category.' });
    if (!Number.isInteger(severity) || severity < 1 || severity > 5) return res.status(400).json({ error: 'Severity must be 1–5.' });
    if (!Number.isInteger(estimatedCost) || estimatedCost < 1000 || estimatedCost > 500000) return res.status(400).json({ error: 'Estimated cost must be ₹1,000–₹500,000.' });
    if (!Number.isFinite(estimatedHours) || estimatedHours < 1 || estimatedHours > 500) return res.status(400).json({ error: 'Estimated hours must be 1–500.' });
    const node = await query('SELECT id,name FROM graph_nodes WHERE id=$1', [nodeId]);
    if (!node.rows.length) return res.status(400).json({ error: 'Choose a location from the list.' });
    const report = { title, description, category, nodeId, locationName: node.rows[0].name, severity, estimatedCost, estimatedHours, status: 'Open', createdBy: Number(req.user.sub), createdAt: new Date(), updatedAt: new Date() };
    const result = await getMongoDb().collection('reports').insertOne(report);
    auditEvent(req, 'report.create', { resourceType: 'report', resourceId: result.insertedId });
    res.status(201).json({ report: { ...report, _id: String(result.insertedId), node: node.rows[0] } });
  } catch (error) { next(error); }
});

router.patch('/:id/status', requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid report ID.' });
    const status = String(req.body.status || '');
    if (!['Open', 'In progress', 'Resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const result = await getMongoDb().collection('reports').findOneAndUpdate({ _id: new ObjectId(req.params.id) }, { $set: { status, updatedAt: new Date() } }, { returnDocument: 'after' });
    if (!result) return res.status(404).json({ error: 'Report not found.' });
    auditEvent(req, 'report.status.update', { resourceType: 'report', resourceId: req.params.id });
    res.json({ report: { ...result, _id: String(result._id) } });
  } catch (error) { next(error); }
});

module.exports = router;
