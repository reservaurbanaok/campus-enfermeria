const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildHandoffContext } = require('../handoff/omega-handoff-context');

const schema = JSON.parse(fs.readFileSync('schemas/omega-handoff-context-v1.json', 'utf8'));
const now = '2026-08-24T12:00:00.000Z';
const base = { conversation_id: 'conversation-1', channel: 'campus_web', identity: { anonymous_id: 'anon-1', verified_identity_status: 'claimed', name_if_known: 'Test User' }, active_course: { course_id: 'course-1', slug: 'course-one', public_name: 'Course One', price: '$secret' }, detected_intent: 'enrollment', questions_asked: ['¿Cuándo inicia?'], relevant_answers: ['Viernes'], objections: ['precio'], unresolved_items: ['forma de pago'], actions_taken: [{ action_type: 'answer_given', status: 'completed', timestamp: now }], academic_progress: 'private', lessons: ['private'], evaluations: ['private'], grades: [10], raw_transcript: 'private transcript', password: 'secret', source_references: ['official-source'] };

function assertSchemaShape(value) {
  for (const key of schema.required) assert(Object.hasOwn(value, key), `missing ${key}`);
  assert.equal(value.schema_version, 'omega-handoff-context-v1');
  assert(value.excluded_data_domains.includes('NETROOM_PRIVATE'));
  assert.equal(Object.hasOwn(value, 'raw_transcript'), false);
  assert.equal(Object.hasOwn(value, 'academic_progress'), false);
  assert.equal(Object.hasOwn(value, 'grades'), false);
  assert.equal(Object.hasOwn(value.active_course, 'price'), false);
}

const human = buildHandoffContext(base, { trigger_code: 'USER_REQUESTED_HUMAN', reason: 'User requested a person', priority: 'high' }, { handoff_id: 'handoff-1', now });
assertSchemaShape(human);
assert.equal(human.handoff_id, 'handoff-1');
assert.equal(human.trigger_code, 'USER_REQUESTED_HUMAN');
assert.equal(human.verified_identity_status, 'unknown');

const commercial = buildHandoffContext({ ...base, identity: { verified_identity_status: 'unknown' } }, { trigger_code: 'COMMERCIAL_EXCEPTION', reason: 'Special commercial condition', priority: 'high' }, { now });
assertSchemaShape(commercial);
assert.equal(commercial.trigger_code, 'COMMERCIAL_EXCEPTION');
assert.equal(commercial.verified_identity_status, 'unknown');
assert.equal(Object.hasOwn(commercial, 'raw_transcript'), false);
assert.equal(Object.hasOwn(commercial, 'lessons'), false);
assert.equal(Object.hasOwn(commercial, 'evaluations'), false);
assert.equal(Object.hasOwn(commercial, 'attempts'), false);

console.log('Gate 05 05.1B context builder/privacy: PASS');
