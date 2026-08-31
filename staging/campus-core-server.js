'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const ingressHandler = require('../api/omega/channel-ingress/v1');
const instagramSocialHandler = require('../api/omega/social/instagram');
const instagramOAuthHandler = require('../api/omega/social/instagram-oauth');
const commercialIntelligenceHandler = require('../api/dashboard/commercial-intelligence');
const retentionEligibilityHandler = require('../api/dashboard/retention-eligibility');
const enrollmentCompletedHandler = require('../api/omega/lifecycle/enrollment-completed');
const lifecycleSignalsHandler = require('../api/omega/lifecycle/gate06-lifecycle-signals');
const dashboardLoginHandler = require('../api/auth/login');
const dashboardLogoutHandler = require('../api/auth/logout');
const dashboardAuthStatusHandler = require('../api/auth/status');

const port = Number(process.env.PORT || 3000);
const ingressPath = '/api/omega/channel-ingress/v1';
const instagramSocialPath = '/webhook/gate08/instagram';
const instagramOAuthPaths = new Set([
  '/oauth/gate08/instagram',
  '/oauth/gate08/instagram/callback',
  '/oauth/gate08/instagram/status',
]);
const commercialIntelligenceApiPath = '/api/dashboard/commercial-intelligence';
const retentionEligibilityApiPath = '/api/dashboard/retention-eligibility';
const enrollmentCompletedPath = '/api/omega/lifecycle/enrollment-completed';
const lifecycleSignalsPath = '/api/omega/lifecycle/gate06-signals';
const commercialIntelligenceViewPath = '/dashboard/commercial-intelligence';
const dashboardAuthPaths = new Map([
  ['/api/auth/login', dashboardLoginHandler],
  ['/api/auth/logout', dashboardLogoutHandler],
  ['/api/auth/status', dashboardAuthStatusHandler],
]);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/healthz') return json(res, 200, { ok: true, service: 'omega-campus-core-staging' });
  if (requestUrl.pathname === commercialIntelligenceViewPath) {
    res.statusCode = 200;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'commercial-intelligence.html')));
  }
  if (dashboardAuthPaths.has(requestUrl.pathname)) return dashboardAuthPaths.get(requestUrl.pathname)(req, res);
  if (requestUrl.pathname === commercialIntelligenceApiPath) return commercialIntelligenceHandler(req, res);
  if (requestUrl.pathname === retentionEligibilityApiPath) return retentionEligibilityHandler(req, res);
  if (requestUrl.pathname === enrollmentCompletedPath) return enrollmentCompletedHandler(req, res);
  if (requestUrl.pathname === lifecycleSignalsPath) return lifecycleSignalsHandler(req, res);
  if (requestUrl.pathname === instagramSocialPath) return instagramSocialHandler(req, res, requestUrl);
  if (instagramOAuthPaths.has(requestUrl.pathname)) return instagramOAuthHandler(req, res, requestUrl);
  if (requestUrl.pathname !== ingressPath) return json(res, 404, { error: 'not_found' });

  Promise.resolve(ingressHandler(req, res)).catch(() => {
    if (!res.writableEnded) json(res, 500, { error: 'internal_error' });
  });
});

async function start() {
  await instagramOAuthHandler.restoreCredentialOnBoot();
  instagramOAuthHandler.startCredentialMaintenance();
  server.listen(port, '0.0.0.0');
}

start().catch(() => {
  server.listen(port, '0.0.0.0');
});
