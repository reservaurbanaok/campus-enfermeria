'use strict';

const { getDatabase } = require('../_lib/db');
const { requireSession } = require('../_lib/auth');
const { getCommercialIntelligence } = require('../_lib/commercial-event-store');

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

function createCommercialIntelligenceHandler(options = {}) {
  const database = options.database || (() => getDatabase());
  const authorize = options.authorize || ((req, res) => requireSession(req, res));
  return async function commercialIntelligence(req, res) {
    if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
    if (!authorize(req, res)) return;
    try {
      return json(res, 200, await getCommercialIntelligence(database(), queryFrom(req)));
    } catch (error) {
      const status = error?.message === 'invalid_date_range' ? 400 : 503;
      return json(res, status, { error: status === 400 ? 'invalid_date_range' : 'commercial_intelligence_unavailable' });
    }
  };
}

module.exports = createCommercialIntelligenceHandler();
module.exports.createCommercialIntelligenceHandler = createCommercialIntelligenceHandler;
