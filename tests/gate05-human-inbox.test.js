const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');

const html = fs.readFileSync('human-inbox.html', 'utf8');
const js = fs.readFileSync('assets/omega-human-inbox.js', 'utf8');
const css = fs.readFileSync('assets/omega-human-inbox.css', 'utf8');

test('Human Inbox UI contract is isolated and privacy-safe', () => {
  for (const id of ['login-form', 'case-list', 'detail-content', 'claim', 'resolve-form', 'resolution-summary']) assert.match(html, new RegExp(`id="${id}"`));
  for (const endpoint of ['/api/auth/operator-login', '/api/handoffs', '/claim', '/resolve']) assert.match(js, new RegExp(endpoint.replace('/', '\\/')));
  assert.match(js, /credentials:\s*'same-origin'/);
  assert.match(html, /TOMAR CASO/); assert.match(html, /RESOLVER/);
  assert.match(css, /@media \(max-width:760px\)/); assert.match(css, /@media \(max-width:430px\)/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|DASHBOARD_PASSWORD|NETROOM_PRIVATE|raw_transcript/);
});
