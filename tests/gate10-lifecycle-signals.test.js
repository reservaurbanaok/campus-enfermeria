'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const test = require('node:test');
const { EVENT_SCHEMA_VERSION } = require('../api/_lib/commercial-event-store');
const { createEnrollmentCompletedHandler, acceptAuthorizedEnrollmentConfirmation } = require('../api/omega/lifecycle/enrollment-completed');
const { createLifecycleSignalsHandler, acceptAuthorizedLifecycleSignal } = require('../api/omega/lifecycle/gate06-lifecycle-signals');

const SECRET = 'gate10-test-bridge-secret';

function payload(event_type, overrides = {}) {
  return {
    event_type, event_id: `${event_type}-test-1`, timestamp: new Date().toISOString(),
    course_id: 'cuidados_criticos_emergencias', person_id: `sha256:${'b'.repeat(64)}`,
    conversation_id: 'campus-lifecycle-test-conversation', correlation_id: 'gate10-lifecycle-test-correlation',
    ...(event_type === 'onboarding_started' ? { onboarding_status: 'STARTED' } : event_type === 'netroom_access_ready' ? { access_status: 'READY' } : { completion_status: 'COMPLETED' }), ...overrides,
  };
}

function signedRequest(value, overrides = {}) {
  const body = Buffer.from(JSON.stringify(value));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = overrides.nonce || `gate10-${value.event_id}`;
  const signature = crypto.createHmac('sha256', SECRET).update(`${timestamp}\n${nonce}\n`).update(body).digest('hex');
  return { method: overrides.method || 'POST', body, headers: { 'x-omega-timestamp': timestamp, 'x-omega-nonce': nonce, 'x-omega-signature': signature, 'x-omega-idempotency-key': value.event_id } };
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
    if (sql.includes('SELECT event_id')) return { rows: this.rows.slice() };
    return { rows: [] };
  }
}

test('Movement 1: onboarding_started is accepted only after enrollment and projects ONBOARDING', async () => {
  const db = new FakeDatabase();
  await acceptAuthorizedEnrollmentConfirmation(db, { event_type: 'enrollment_completed', event_id: 'enrollment-before-onboarding', timestamp: new Date().toISOString(), course_id: 'cuidados_criticos_emergencias', person_id: `sha256:${'b'.repeat(64)}`, conversation_id: 'campus-lifecycle-test-conversation', correlation_id: 'gate10-enrollment-correlation' }, 'enrollment-before-onboarding');
  const first = await acceptAuthorizedLifecycleSignal(db, payload('onboarding_started'), 'onboarding_started-test-1');
  const replay = await acceptAuthorizedLifecycleSignal(db, payload('onboarding_started'), 'onboarding_started-test-1');
  assert.equal(first.inserted, true);
  assert.equal(first.event_type, 'onboarding_started');
  assert.equal(first.schema_version, EVENT_SCHEMA_VERSION);
  assert.equal(first.lifecycle_state, 'ONBOARDING');
  assert.equal(first.retention_status, 'RETENTION_ELIGIBLE');
  assert.equal(replay.deduplicated, true);
  assert.equal(db.rows.filter((row) => row.event_type === 'onboarding_started').length, 1);
});

test('Movement 2: netroom_access_ready requires onboarding and projects NETROOM_READY', async () => {
  const db = new FakeDatabase();
  await acceptAuthorizedEnrollmentConfirmation(db, { event_type: 'enrollment_completed', event_id: 'enrollment-before-ready', timestamp: new Date().toISOString(), course_id: 'cuidados_criticos_emergencias', person_id: `sha256:${'c'.repeat(64)}`, conversation_id: 'campus-ready-test-conversation', correlation_id: 'gate10-ready-enrollment' }, 'enrollment-before-ready');
  await acceptAuthorizedLifecycleSignal(db, payload('onboarding_started', { event_id: 'onboarding-before-ready', conversation_id: 'campus-ready-test-conversation', person_id: `sha256:${'c'.repeat(64)}` }), 'onboarding-before-ready');
  const result = await acceptAuthorizedLifecycleSignal(db, payload('netroom_access_ready', { event_id: 'ready-test-1', conversation_id: 'campus-ready-test-conversation', person_id: `sha256:${'c'.repeat(64)}` }), 'ready-test-1');
  assert.equal(result.inserted, true);
  assert.equal(result.event_type, 'netroom_access_ready');
  assert.equal(result.lifecycle_state, 'NETROOM_READY');
  assert.equal(result.retention_status, 'RETENTION_ELIGIBLE');
  assert.equal(db.rows.filter((row) => row.event_type === 'course_completed').length, 0);
});

test('readiness sin inscripción es rechazada y no escribe', async () => {
  const db = new FakeDatabase();
  await assert.rejects(() => acceptAuthorizedLifecycleSignal(db, payload('netroom_access_ready'), 'netroom_access_ready-test-1'), { message: 'onboarding_precondition_required' });
  assert.equal(db.rows.length, 0);
});

test('Movement 3: course_completed requires ordered evidence, persists, projects completion and deduplicates replay', async () => {
  const db = new FakeDatabase();
  const person = `sha256:${'e'.repeat(64)}`;
  const conversation = 'campus-completed-test-conversation';
  await acceptAuthorizedEnrollmentConfirmation(db, { event_type: 'enrollment_completed', event_id: 'enrollment-before-completion', timestamp: '2026-08-28T21:00:00.000Z', course_id: 'cuidados_criticos_emergencias', person_id: person, conversation_id: conversation, correlation_id: 'completion-enrollment' }, 'enrollment-before-completion');
  await acceptAuthorizedLifecycleSignal(db, payload('onboarding_started', { event_id: 'onboarding-before-completion', timestamp: '2026-08-28T21:01:00.000Z', person_id: person, conversation_id: conversation }), 'onboarding-before-completion');
  await acceptAuthorizedLifecycleSignal(db, payload('netroom_access_ready', { event_id: 'ready-before-completion', timestamp: '2026-08-28T21:02:00.000Z', person_id: person, conversation_id: conversation }), 'ready-before-completion');
  const completed = await acceptAuthorizedLifecycleSignal(db, payload('course_completed', { event_id: 'completion-test-1', timestamp: '2026-08-28T21:03:00.000Z', person_id: person, conversation_id: conversation }), 'completion-test-1');
  const replay = await acceptAuthorizedLifecycleSignal(db, payload('course_completed', { event_id: 'completion-test-1', timestamp: '2026-08-28T21:03:00.000Z', person_id: person, conversation_id: conversation }), 'completion-test-1');
  assert.equal(completed.inserted, true);
  assert.equal(completed.lifecycle_state, 'COMPLETED');
  assert.equal(completed.retention_status, 'NEXT_COURSE_EVALUATION_ELIGIBLE');
  assert.equal(replay.deduplicated, true);
  assert.equal(db.rows.filter((row) => row.event_type === 'course_completed').length, 1);
  assert.equal(db.rows.find((row) => row.event_type === 'course_completed').metadata_json.completion_status, 'completed');
});

test('course_completed rejects missing or inferred completion status and missing readiness', async () => {
  const db = new FakeDatabase();
  await assert.rejects(() => acceptAuthorizedLifecycleSignal(db, payload('course_completed', { event_id: 'course_completed-test-1', completion_status: undefined }), 'course_completed-test-1'), { message: 'completion_status_invalid' });
  await assert.rejects(() => acceptAuthorizedLifecycleSignal(db, payload('course_completed', { event_id: 'course_completed-test-2', completion_status: 'INFERRED' }), 'course_completed-test-2'), { message: 'completion_status_invalid' });
  await assert.rejects(() => acceptAuthorizedLifecycleSignal(db, payload('course_completed', { event_id: 'course_completed-test-3' }), 'course_completed-test-3'), { message: 'completion_precondition_required' });
  assert.equal(db.rows.length, 0);
});

test('receptor Gate 06 valida firma, método y campos académicos prohibidos', async () => {
  const db = new FakeDatabase();
  const handler = createLifecycleSignalsHandler({ database: () => db, secret: () => SECRET });
  const post = signedRequest(payload('onboarding_started'));
  const ok = response();
  await handler({ ...post, body: post.body }, ok);
  assert.equal(ok.statusCode, 409);
  const forbidden = response();
  const bad = signedRequest(payload('onboarding_started', { grades: [10] }));
  await handler({ ...bad, body: bad.body }, forbidden);
  assert.equal(forbidden.statusCode, 422);
  const get = response();
  await handler({ method: 'GET', headers: {} }, get);
  assert.equal(get.statusCode, 405);
});

test('fixtures remain local and no course completion is emitted by the chain', async () => {
  const db = new FakeDatabase();
  assert.equal(db.rows.length, 0);
  const enrollment = createEnrollmentCompletedHandler({ database: () => db, secret: () => SECRET });
  const signed = signedRequest({ event_type: 'enrollment_completed', event_id: 'fixture-enrollment', timestamp: new Date().toISOString(), course_id: 'cuidados_criticos_emergencias', person_id: `sha256:${'d'.repeat(64)}`, conversation_id: 'fixture-conversation', correlation_id: 'fixture-correlation' });
  const res = response();
  await enrollment({ ...signed, body: signed.body }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.rows.filter((row) => row.event_type === 'course_completed').length, 0);
  assert.equal(db.rows.filter((row) => row.event_type === 'enrollment_completed').length, 1);
});
