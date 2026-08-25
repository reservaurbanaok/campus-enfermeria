'use strict';

const { requireOperator } = require('../../_lib/auth');
const { getDatabase, persistence, sanitizedHandoff, lifecycleStatus } = require('../../_lib/handoffs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const operator = requireOperator(req, res);
  if (!operator) return;
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method_not_allowed' })); }
  let body = '';
  for await (const chunk of req) body += chunk;
  let input;
  try { input = JSON.parse(body); } catch { res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid_json' })); }
  const resolution = { ...input, handoff_id: req.query.handoff_id, resolved_by: operator.operator_id, operator_role: operator.role, created_at: new Date().toISOString() };
  try {
    const row = await persistence.resolveHandoff(getDatabase(), req.query.handoff_id, resolution);
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ handoff: sanitizedHandoff(row) }));
  } catch (error) { res.statusCode = lifecycleStatus(error); res.end(JSON.stringify({ error: error.code || 'handoff_resolve_failed' })); }
};
