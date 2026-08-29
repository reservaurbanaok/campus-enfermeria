'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { PRIMARY_SOURCE_URL, evaluateNextBestCourse } = require('../api/_lib/next-best-course-evaluator');

const catalog = {
  source_url: PRIMARY_SOURCE_URL,
  source_verified: true,
  courses: [
    { course_id: 'cuidados_criticos_emergencias', name: 'Diplomatura en Cuidados Críticos y Emergencias para Enfermería', fit_tags: ['emergencias', 'paciente crítico'], source_ref: PRIMARY_SOURCE_URL },
    { course_id: 'escolar', name: 'Diplomatura en Enfermería Escolar', fit_tags: ['salud escolar', 'pediatría'], source_ref: PRIMARY_SOURCE_URL },
    { course_id: 'anestesia', name: 'Diplomatura en Anestesia y Cirugía para Enfermería', fit_tags: ['anestesia', 'cirugía'], source_ref: PRIMARY_SOURCE_URL },
  ],
};

const completionProjection = {
  status: 'NEXT_COURSE_EVALUATION_ELIGIBLE',
  current_lifecycle_state: 'COMPLETED',
  evidence_events: [{ event_id: 'completion-1', event_type: 'course_completed', course_id: 'cuidados_criticos_emergencias' }],
};

function evaluate(overrides = {}) {
  return evaluateNextBestCourse({ projection: completionProjection, completed_course_id: 'cuidados_criticos_emergencias', goals: ['salud escolar'], catalog, ...overrides });
}

test('A/B/C: prospect, enrolled and NETROOM_READY cannot evaluate next course', () => {
  for (const state of ['PROSPECT', 'ENROLLED', 'NETROOM_READY']) {
    const result = evaluateNextBestCourse({ projection: { status: state === 'PROSPECT' ? 'NOT_RETENTION_ELIGIBLE' : 'RETENTION_ELIGIBLE', current_lifecycle_state: state }, completed_course_id: 'cuidados_criticos_emergencias', goals: ['salud escolar'], catalog });
    assert.equal(result.recommendation_status, 'NO');
  }
});

test('D: explicit completion enables evaluation, without making a recommendation by itself', () => {
  const result = evaluateNextBestCourse({ projection: completionProjection, completed_course_id: 'cuidados_criticos_emergencias' });
  assert.equal(result.recommendation_status, 'INSUFFICIENT_DATA');
});

test('E: completed course plus clear goal and official fit yields one recommendation', () => {
  const result = evaluate();
  assert.equal(result.recommendation_status, 'YES');
  assert.equal(result.recommended_course_id, 'escolar');
  assert.equal(result.source_refs[0], PRIMARY_SOURCE_URL);
  assert.equal(result.evaluation_version, 'next-best-course-v1');
});

test('F: completed course with no fitting official offer returns NO', () => {
  const result = evaluate({ goals: ['salud comunitaria'] });
  assert.equal(result.recommendation_status, 'NO');
  assert.deepEqual(result.reason_codes, ['NO_REASONABLE_FIT']);
});

test('G: missing explicit goal/context returns INSUFFICIENT_DATA', () => {
  assert.equal(evaluate({ goals: [] }).recommendation_status, 'INSUFFICIENT_DATA');
});

test('H: contradictory lifecycle requires human review', () => {
  const result = evaluate({ projection: { status: 'HUMAN_REVIEW_REQUIRED', current_lifecycle_state: 'CONFLICTED' } });
  assert.equal(result.recommendation_status, 'HUMAN_REVIEW');
  assert.equal(result.handoff_needed, true);
});

test('I: unavailable or untrusted official course facts return INSUFFICIENT_DATA', () => {
  assert.equal(evaluate({ catalog: null }).recommendation_status, 'INSUFFICIENT_DATA');
  assert.equal(evaluate({ catalog: { ...catalog, source_url: 'https://example.invalid/' } }).recommendation_status, 'INSUFFICIENT_DATA');
  assert.equal(evaluate({ catalog: { ...catalog, source_verified: false } }).recommendation_status, 'INSUFFICIENT_DATA');
});

test('J: inferred completion is not evaluable', () => {
  const result = evaluateNextBestCourse({ projection: { status: 'RETENTION_ELIGIBLE', current_lifecycle_state: 'STUDENT', evidence_events: [] }, completed_course_id: 'cuidados_criticos_emergencias', goals: ['salud escolar'], catalog });
  assert.equal(result.recommendation_status, 'NO');
});

test('equal fits are held for human review and no event is emitted', () => {
  const result = evaluate({ catalog: { ...catalog, courses: [catalog.courses[0], { ...catalog.courses[1], fit_tags: ['salud escolar'] }, { ...catalog.courses[2], fit_tags: ['salud escolar'] }] } });
  assert.equal(result.recommendation_status, 'HUMAN_REVIEW');
  assert.equal(result.handoff_needed, true);
  assert.equal(Object.hasOwn(result, 'event_type'), false);
});
