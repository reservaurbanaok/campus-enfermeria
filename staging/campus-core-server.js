'use strict';

const http = require('http');
const { URL } = require('url');
const ingressHandler = require('../api/omega/channel-ingress/v1');

const port = Number(process.env.PORT || 3000);
const ingressPath = '/api/omega/channel-ingress/v1';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/healthz') return json(res, 200, { ok: true, service: 'omega-campus-core-staging' });
  if (requestUrl.pathname !== ingressPath) return json(res, 404, { error: 'not_found' });

  Promise.resolve(ingressHandler(req, res)).catch(() => {
    if (!res.writableEnded) json(res, 500, { error: 'internal_error' });
  });
});

server.listen(port, '0.0.0.0');
