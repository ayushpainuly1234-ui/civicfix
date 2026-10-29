function auditEvent(req, action, fields = {}) {
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
  // Never include passwords, email addresses, or user-supplied report text in audit logs.
  console.info(JSON.stringify(event));
}

module.exports = { auditEvent };
