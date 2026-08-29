'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PROJECTION_VERSION, projectRetentionEligibility, getRetentionEligibility,
} = require('../api/_lib/retention-eligibility-projector');
const { createRetentionEligibilityHandler } = require('../api/dashboard/retention-eligibility');

function event(event_type, extra = {}) {
  return {
    event_id: `${event_type}-1`, event_type, event_timestamp: '2026-08-28T21:00:00.000Z',
    person_or_anonymous_id: 'sha256:person-reference', metadata_json: {}, ...extra,
  };
}

class FakeDatabase {
  constructor(rows = []) { this.rows = rows.slice(); this.queries = []; }
  async query(sql, params) {
    this.queries.push({ sql, params });
    return { rows: this.rows.slice() };
  }
}

function response() {
  return { statusCode: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = String(value || ''); } };
}

test('A: intent-only remains outside retention eligibility', () => {
  const projection = projectRetentionEligibility([event('intent_detected')]);
  assert.equal(projection.status, 'NOT_RETENTION_ELIGIBLE');
  assert.equal(projection.current_lifecycle_state, 'PROSPECT');
  assert.notEqual(projection.status, 'NEXT_COURSE_EVALUATION_ELIGIBLE');
});

test('B: enrollment_completed allows accompaniment but not next course', () => {
  const projection = projectRetentionEligibility([event('enrollment_completed', { course_id: 'cuidados_criticos_emergencias' })]);
  assert.equal(projection.status, 'RETENTION_ELIGIBLE');
  assert.equal(projection.current_lifecycle_state, 'ENROLLED');
  assert.notEqual(projection.status, 'NEXT_COURSE_EVALUATION_ELIGIBLE');
});

test('C: onboarding and ready signals allow accompaniment without academic inference', () => {
  const projection = projectRetentionEligibility([
    event('enrollment_completed'), event('onboarding_started'), event('netroom_access_ready'),
  ]);
  assert.equal(projection.status, 'RETENTION_ELIGIBLE');
  assert.equal(projection.current_lifecycle_state, 'NETROOM_READY');
  assert.deepEqual(projection.reason_codes.includes('NO_COURSE_COMPLETION'), true);
});

test('D: explicit authorized course completion after ordered readiness unlocks next-course evaluation only', () => {
  const projection = projectRetentionEligibility([
    event('enrollment_completed', { event_id: 'enrollment-d', course_id: 'cuidados_criticos_emergencias' }),
    event('onboarding_started', { event_id: 'onboarding-d', event_timestamp: '2026-08-28T21:01:00.000Z', metadata_json: { authorized: true } }),
    event('netroom_access_ready', { event_id: 'ready-d', event_timestamp: '2026-08-28T21:02:00.000Z', metadata_json: { authorized: true } }),
    event('course_completed', { event_id: 'completed-d', event_timestamp: '2026-08-28T21:03:00.000Z', course_id: 'cuidados_criticos_emergencias', metadata_json: { authorized: true, completion_status: 'completed' } }),
  ]);
  assert.equal(projection.status, 'NEXT_COURSE_EVALUATION_ELIGIBLE');
  assert.equal(projection.current_lifecycle_state, 'COMPLETED');
  assert.deepEqual(projection.reason_codes, ['EXPLICIT_COURSE_COMPLETION']);
});

test('completion inferred without explicit authorized status never unlocks evaluation', () => {
  const projection = projectRetentionEligibility([
    event('enrollment_completed'), event('onboarding_started'), event('netroom_access_ready'),
    event('course_completed', { metadata_json: { completed: true } }),
  ]);
  assert.notEqual(projection.status, 'NEXT_COURSE_EVALUATION_ELIGIBLE');
});

test('completion before ordered NETROOM readiness requires human review', () => {
  const projection = projectRetentionEligibility([
    event('enrollment_completed'),
    event('course_completed', { event_id: 'completed-before-ready', event_timestamp: '2026-08-28T21:00:00.000Z', metadata_json: { authorized: true, completion_status: 'completed' } }),
    event('onboarding_started', { event_id: 'onboarding-after', event_timestamp: '2026-08-28T21:01:00.000Z' }),
    event('netroom_access_ready', { event_id: 'ready-after', event_timestamp: '2026-08-28T21:02:00.000Z' }),
  ]);
  assert.equal(projection.status, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(projection.current_lifecycle_state, 'CONFLICTED');
});

test('E: incompatible lifecycle evidence requires human review', () => {
  const projection = projectRetentionEligibility([
    event('enrollment_completed', { metadata_json: { enrollment_status: 'completed' } }),
    event('enrollment_cancelled', { metadata_json: { enrollment_status: 'cancelled' } }),
  ]);
  assert.equal(projection.status, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(projection.current_lifecycle_state, 'CONFLICTED');
});

test('E2: netroom_access_ready without enrollment evidence is not accepted', () => {
  const projection = projectRetentionEligibility([event('netroom_access_ready')]);
  assert.equal(projection.status, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(projection.current_lifecycle_state, 'CONFLICTED');
});

test('F: missing evidence is insufficient data', () => {
  const projection = projectRetentionEligibility([]);
  assert.equal(projection.status, 'INSUFFICIENT_DATA');
  assert.equal(projection.current_lifecycle_state, 'UNKNOWN');
  assert.equal(projection.projection_version, PROJECTION_VERSION);
});

test('test fixtures are excluded and the projection output is sanitized', () => {
  const projection = projectRetentionEligibility([
    event('course_completed', { metadata_json: { test_event: true, message: 'private' } }),
    event('intent_detected', { metadata_json: { message: 'private' } }),
  ]);
  assert.equal(projection.status, 'NOT_RETENTION_ELIGIBLE');
  assert.equal(JSON.stringify(projection).includes('private'), false);
  assert.equal(JSON.stringify(projection).includes('test_event'), false);
});

test('API de proyección es GET-only, autenticada y sólo consulta el Event Store', async () => {
  const db = new FakeDatabase([event('intent_detected')]);
  const handler = createRetentionEligibilityHandler({ database: () => db, authorize: () => true });
  const denied = response();
  await handler({ method: 'POST', url: '/?conversation_id=c1' }, denied);
  assert.equal(denied.statusCode, 405);
  const ok = response();
  await handler({ method: 'GET', url: '/?conversation_id=c1' }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(JSON.parse(ok.body).status, 'NOT_RETENTION_ELIGIBLE');
  assert.equal(db.queries.length, 1);
  assert.equal(db.queries[0].sql.includes('INSERT'), false);
});

test('la evaluación de datos reales actuales no produce falso positivo de next-course', async () => {
  const db = new FakeDatabase([event('intent_detected', { conversation_id: 'real' })]);
  const projection = await getRetentionEligibility(db, { conversation_id: 'real' });
  assert.equal(projection.status, 'NOT_RETENTION_ELIGIBLE');
  assert.equal(projection.status === 'NEXT_COURSE_EVALUATION_ELIGIBLE', false);
});
