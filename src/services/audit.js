const { query } = require('../db/postgres');

async function auditEvent(req, action, fields = {}) {
  const event = {
    type: 'audit',
    timestamp: new Date().toISOString(),
    requestId: req.requestId || null,
    action,
    actorId: fields.actorId ?? req.user?.sub ?? null,
    actorRole: fields.actorRole ?? req.user?.role ?? 'anonymous',
    outcome: fields.outcome || 'success',
    resourceType: fields.resourceType || null,
    resourceId: fields.resourceId == null ? null : String(fields.resourceId)
  };

  // Never include passwords, email addresses, or user-supplied report text in audit events.
  console.info(JSON.stringify(event));
  try {
    await query(
      `INSERT INTO audit_logs
       (request_id,event_type,actor_id,actor_role,outcome,resource_type,resource_id)
       VALUES ($1::uuid,$2,$3::bigint,$4,$5,$6,$7)`,
      [event.requestId, event.action, event.actorId == null ? null : String(event.actorId),
        event.actorRole, event.outcome, event.resourceType, event.resourceId]
    );
    return true;
  } catch (error) {
    // Preserve the user's operation, while making an audit persistence failure observable.
    console.error(JSON.stringify({
      type: 'audit_persistence_error',
      timestamp: new Date().toISOString(),
      requestId: event.requestId,
      action: event.action,
      error: error.message
    }));
    return false;
  }
}

module.exports = { auditEvent };
