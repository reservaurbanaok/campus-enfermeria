const assert = require('node:assert/strict');
const { test } = require('node:test');
const { operatorSessionCookie, operatorFromSession } = require('../api/_lib/auth');
const operatorLogin = require('../api/auth/operator-login');

process.env.HANDOFF_OPERATOR_ID = 'operator-test';
process.env.HANDOFF_OPERATOR_ROLE = 'OPERATOR';
process.env.HANDOFF_OPERATOR_SESSION_SECRET = 'session-secret-test';
process.env.HANDOFF_OPERATOR_CREDENTIAL = 'dedicated-operator-credential';
process.env.DASHBOARD_PASSWORD = 'same-value-must-not-be-used';

const cookie = operatorSessionCookie();
assert(cookie && cookie.includes('campus_operator_session='));
const request = (value) => ({ headers: { cookie: `campus_operator_session=${value}` } });
const value = cookie.match(/campus_operator_session=([^;]+)/)[1];
assert.deepEqual(operatorFromSession(request(value)), { operator_id: 'operator-test', role: 'OPERATOR' });
assert.equal(operatorFromSession(request(value.slice(0, -1) + (value.endsWith('a') ? 'b' : 'a'))), null);
assert.equal(operatorFromSession({ headers: { cookie: 'campus_dashboard_session=generic-session' } }), null);
assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);

async function invokeLogin(credential) {
  const chunks = [JSON.stringify({ credential })];
  const response = { headers: {}, statusCode: 200, body: '', setHeader(name, value) { this.headers[name] = value; }, end(value = '') { this.body = value; } };
  const request = { method: 'POST', async *[Symbol.asyncIterator]() { yield* chunks; } };
  await operatorLogin(request, response);
  return response;
}

test('operator login uses dedicated credential and signed session', async () => {
  const validLogin = await invokeLogin(process.env.HANDOFF_OPERATOR_CREDENTIAL);
  assert.equal(validLogin.statusCode, 200);
  assert.ok(validLogin.headers['Set-Cookie']);
  assert.deepEqual(operatorFromSession({ headers: { cookie: validLogin.headers['Set-Cookie'] } }), { operator_id: 'operator-test', role: 'OPERATOR' });
  assert.equal((await invokeLogin('wrong-credential')).statusCode, 401);
  assert.equal((await invokeLogin(process.env.DASHBOARD_PASSWORD)).statusCode, 401);
});
console.log('Operator identity/session guards: PASS');
