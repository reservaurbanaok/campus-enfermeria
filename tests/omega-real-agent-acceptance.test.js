'use strict';

const assert = require('node:assert/strict');
const { createSession } = require('../core/omega-concierge-core');
const { resolveConversationalResponse } = require('../core/omega-conversational-resolver');
const { MemoryConversationStateStore } = require('../core/omega-conversation-state');
const { PRIMARY_SOURCE_URL } = require('../core/omega-official-source');

const verifiedSource = (intent) => async () => ({
  status: 'VERIFIED', source_used: true, source_url: PRIMARY_SOURCE_URL,
  source_timestamp: '2026-08-31T12:00:00.000Z', required_fact_found: true,
  evidence: intent === 'PRICE' ? 'Cuidados Críticos: $49.000 por mes' : 'Duración total 6 meses. Modalidad Zoom sincrónico.',
});

const unavailableSource = async () => ({ status: 'SOURCE_UNAVAILABLE', source_used: false, source_url: PRIMARY_SOURCE_URL, source_timestamp: null, required_fact_found: false, evidence: '' });
const absentFactSource = async () => ({ status: 'INSUFFICIENT', source_used: false, source_url: PRIMARY_SOURCE_URL, source_timestamp: '2026-08-31T12:00:00.000Z', required_fact_found: false, evidence: 'La capacitación no publica valores en esta página.' });
const agent = (text) => ({ provider: 'test-agent', model: 'test-model', generate: async () => text });

async function run() {
  const down = await resolveConversationalResponse(createSession({ started: true }), '¿Cuánto cuesta Cuidados Críticos?', {
    channel: 'test', external_sender_id: 'a', stateStore: new MemoryConversationStateStore(), sourceRetriever: unavailableSource, modelProvider: agent('El precio es $99.000 por mes.'),
  });
  assert.equal(down.grounding_status, 'SOURCE_UNAVAILABLE');
  assert.equal(down.response_mode, 'DETERMINISTIC_FALLBACK');
  assert.equal(/\$\s?[0-9]/.test(down.text), false, 'source outage must not invent a price');

  const absent = await resolveConversationalResponse(createSession({ started: true }), '¿Cuánto cuesta Cuidados Críticos?', {
    channel: 'test', external_sender_id: 'b', stateStore: new MemoryConversationStateStore(), sourceRetriever: absentFactSource, modelProvider: agent('El precio es $99.000 por mes.'),
  });
  assert.equal(absent.grounding_status, 'INSUFFICIENT');
  assert.equal(absent.response_mode, 'DETERMINISTIC_FALLBACK');
  assert.equal(/\$\s?[0-9]/.test(absent.text), false, 'absent fact must not fabricate a price');

  const states = new MemoryConversationStateStore();
  await resolveConversationalResponse(createSession({ started: true }), 'Quiero información sobre Cuidados Críticos.', {
    channel: 'test', external_sender_id: 'c', stateStore: states, sourceRetriever: verifiedSource('EXPLORE_OPTIONS'), modelProvider: agent('Puedo ayudarte a evaluar esa capacitación.'),
  });
  const continuity = await resolveConversationalResponse(createSession({ started: true }), '¿Y cuánto dura?', {
    channel: 'test', external_sender_id: 'c', stateStore: states, sourceRetriever: verifiedSource('DURATION'), modelProvider: agent('La duración publicada es de 6 meses.'),
  });
  const saved = await states.load('test:c');
  assert.equal(saved.current_course, 'cuidados_criticos_emergencias');
  assert.equal(continuity.selected_skill, 'OMEGA_ADMISSIONS');
  assert.equal(continuity.skill_executed, true);
  assert.equal(continuity.conversation_history_used, true);
  assert.equal(saved.raw_recent_turns.length, 4);

  const modelFailure = await resolveConversationalResponse(createSession({ started: true }), 'Hola', {
    channel: 'test', external_sender_id: 'd', stateStore: new MemoryConversationStateStore(), sourceRetriever: unavailableSource, modelProvider: { provider: 'test-agent', model: 'test-model', generate: async () => { throw Object.assign(new Error('down'), { code: 'provider_down' }); } },
  });
  assert.equal(modelFailure.response_mode, 'DETERMINISTIC_FALLBACK');
  assert.equal(modelFailure.response_type, 'text');

  const sourceSuccess = await resolveConversationalResponse(createSession({ started: true }), '¿Cuánto cuesta Cuidados Críticos?', {
    channel: 'test', external_sender_id: 'e', stateStore: new MemoryConversationStateStore(), sourceRetriever: verifiedSource('PRICE'), modelProvider: agent('El valor publicado es $49.000 por mes.'),
  });
  assert.equal(sourceSuccess.response_mode, 'AGENT');
  assert.equal(sourceSuccess.grounding_status, 'VERIFIED');
  assert.equal(sourceSuccess.source_used, true);
  assert.equal(sourceSuccess.source_url, PRIMARY_SOURCE_URL);
  assert.equal(typeof sourceSuccess.source_timestamp, 'string');
  assert.equal(sourceSuccess.selected_skill, 'OMEGA_ADMISSIONS');
  assert.equal(sourceSuccess.skill_executed, true);

  console.log('OMEGA real agent acceptance: PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
