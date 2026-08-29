'use strict';

const { getDatabase } = require('../_lib/db');
const { requireSession } = require('../_lib/auth');
const { getRetentionEligibility } = require('../_lib/retention-eligibility-projector');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function queryFrom(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  const url = new URL(req.url || '/', 'http://localhost');
  return Object.fromEntries(url.searchParams.entries());
}

function createRetentionEligibilityHandler(options = {}) {
  const database = options.database || (() => getDatabase());
  const authorize = options.authorize || ((req, res) => requireSession(req, res));
  return async function retentionEligibility(req, res) {
    if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
    if (!authorize(req, res)) return;
    try {
      return json(res, 200, await getRetentionEligibility(database(), queryFrom(req)));
    } catch (error) {
      const clientErrors = new Set(['selector_required', 'selector_invalid', 'person_reference_invalid']);
      const status = clientErrors.has(error?.message) ? 400 : 503;
      return json(res, status, { error: clientErrors.has(error?.message) ? error.message : 'retention_eligibility_unavailable' });
    }
  };
}

module.exports = createRetentionEligibilityHandler();
module.exports.createRetentionEligibilityHandler = createRetentionEligibilityHandler;
