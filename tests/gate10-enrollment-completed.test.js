'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const test = require('node:test');
const { EVENT_SCHEMA_VERSION } = require('../api/_lib/commercial-event-store');
const { createEnrollmentCompletedHandler, acceptAuthorizedEnrollmentConfirmation } = require('../api/omega/lifecycle/enrollment-completed');

const SECRET = 'gate10-test-bridge-secret';

function payload(overrides = {}) {
  return {
    event_type: 'enrollment_completed', event_id: 'enrollment-test-1',
    timestamp: new Date().toISOString(), course_id: 'cuidados_criticos_emergencias',
    person_id: `sha256:${'a'.repeat(64)}`, conversation_id: 'campus-test-conversation',
    correlation_id: 'gate10-test-correlation', ...overrides,
  };
}

function signedRequest(value, overrides = {}) {
  const body = Buffer.from(JSON.stringify(value));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = overrides.nonce || 'gate10-test-nonce';
  const signature = crypto.createHmac('sha256', SECRET).update(`${timestamp}\n${nonce}\n`).update(body).digest('hex');
  return {
    method: overrides.method || 'POST', body,
    headers: { 'x-omega-timestamp': timestamp, 'x-omega-nonce': nonce, 'x-omega-signature': signature, 'x-omega-idempotency-key': value.event_id },
  };
}

function response() {
  return { statusCode: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = String(value || ''); } };
}

class FakeDatabase {
  constructor() { this.rows = []; this.queries = []; }
  async query(sql, params) {
    this.queries.push({ sql, params });
    if (sql.includes('INSERT INTO')) {
      if (this.rows.some((row) => row.event_id === params[0])) return { rows: [] };
      this.rows.push({ event_id: params[0], event_type: params[1], schema_version: params[2], event_timestamp: params[3], conversation_id: params[4], channel: params[5], person_or_anonymous_id: params[6], course_id: params[7], metadata_json: JSON.parse(params[8]), source: params[9], correlation_id: params[10] });
      return { rows: [{ event_id: params[0] }] };
    }
    return { rows: [] };
  }
}

test('confirmación autorizada produce un único enrollment_completed y transición ENROLLED', async () => {
  const db = new FakeDatabase();
  const first = await acceptAuthorizedEnrollmentConfirmation(db, payload(), 'enrollment-test-1');
  const replay = await acceptAuthorizedEnrollmentConfirmation(db, payload(), 'enrollment-test-1');
  assert.equal(first.inserted, true);
  assert.equal(first.deduplicated, false);
  assert.equal(first.event_type, 'enrollment_completed');
  assert.equal(first.schema_version, EVENT_SCHEMA_VERSION);
  assert.equal(first.lifecycle_state, 'ENROLLED');
  assert.equal(first.retention_status, 'RETENTION_ELIGIBLE');
  assert.equal(replay.inserted, false);
  assert.equal(replay.deduplicated, true);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].metadata_json.authorized, true);
  assert.equal(db.rows[0].metadata_json.enrollment_status, 'completed');
  assert.equal(db.rows[0].source, 'gate06_enrollment_bridge');
  assert.equal(db.rows[0].channel, 'campus_web');
  assert.equal(db.rows[0].correlation_id.startsWith('sha256:'), true);
});

test('receptor requiere firma, payload mínimo e idempotency key', async () => {
  const db = new FakeDatabase();
  const handler = createEnrollmentCompletedHandler({ database: () => db, secret: () => SECRET });
  const invalid = response();
  const request = signedRequest(payload({ event_id: 'enrollment-test-invalid', person_id: 'raw-email@example.com' }));
  await handler({ method: 'POST', body: request.body, headers: {} }, invalid);
  assert.equal(invalid.statusCode, 401);
  const valid = response();
  const signed = signedRequest(payload());
  await handler({ ...signed, body: signed.body }, valid);
  assert.equal(valid.statusCode, 200);
  assert.equal(JSON.parse(valid.body).retention_status, 'RETENTION_ELIGIBLE');
  assert.equal(db.rows.length, 1);
});

test('receptor rechaza source claims, campos sensibles y curso no canónico', async () => {
  const handler = createEnrollmentCompletedHandler({ database: () => new FakeDatabase(), secret: () => SECRET });
  for (const value of [
    payload({ source: 'client' }),
    payload({ access_token: 'must-not-be-accepted' }),
    payload({ course_id: 'unknown-course' }),
  ]) {
    const res = response();
    const req = signedRequest(value);
    await handler({ ...req, body: req.body }, res);
    assert.equal(res.statusCode, 422);
  }
});

test('receptor es POST-only y no escribe ante método incorrecto', async () => {
  const db = new FakeDatabase();
  const handler = createEnrollmentCompletedHandler({ database: () => db, secret: () => SECRET });
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(db.queries.length, 0);
});

test('completion explícito no habilita next-course', async () => {
  const db = new FakeDatabase();
  const result = await acceptAuthorizedEnrollmentConfirmation(db, payload(), 'enrollment-test-1');
  assert.equal(result.retention_status, 'RETENTION_ELIGIBLE');
  assert.notEqual(result.retention_status, 'NEXT_COURSE_EVALUATION_ELIGIBLE');
  assert.equal(db.rows.filter((row) => row.event_type === 'course_completed').length, 0);
});
