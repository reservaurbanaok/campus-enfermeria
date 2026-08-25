'use strict';

const { requireOperator } = require('../_lib/auth');
const { listHandoffs } = require('../_lib/handoffs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const operator = requireOperator(req, res);
  if (!operator) return;
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method_not_allowed' })); }
  try {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ handoffs: await listHandoffs() }));
  } catch { res.statusCode = 503; res.end(JSON.stringify({ error: 'handoff_storage_unavailable' })); }
};
