'use strict';

const { requireOperator } = require('../_lib/auth');
const { getHandoff } = require('../_lib/handoffs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!requireOperator(req, res)) return;
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method_not_allowed' })); }
  const handoffId = req.query && req.query.handoff_id;
  try {
    const handoff = await getHandoff(handoffId);
    if (!handoff) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'handoff_not_found' })); }
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ handoff }));
  } catch { res.statusCode = 503; res.end(JSON.stringify({ error: 'handoff_storage_unavailable' })); }
};
