'use strict';

const { requireOperator } = require('../../_lib/auth');
const { getDatabase, persistence, sanitizedHandoff, lifecycleStatus } = require('../../_lib/handoffs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const operator = requireOperator(req, res);
  if (!operator) return;
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method_not_allowed' })); }
  try {
    const row = await persistence.claimHandoff(getDatabase(), req.query.handoff_id, { id: operator.operator_id, role: operator.role });
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ handoff: sanitizedHandoff(row) }));
  } catch (error) { res.statusCode = lifecycleStatus(error); res.end(JSON.stringify({ error: error.code || 'handoff_claim_failed' })); }
};
