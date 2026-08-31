'use strict';

const assert = require('node:assert/strict');
const { createSession } = require('../core/omega-concierge-core');
const { resolveConversationalResponse } = require('../core/omega-conversational-resolver');
const { createOfficialSourceRetriever, PRIMARY_SOURCE_URL } = require('../core/omega-official-source');
const { MemoryConversationStateStore } = require('../core/omega-conversation-state');
const { detectIntent } = require('../core/omega-conversational-resolver');

const catalogHtml = `
  <h1>Campus Profesional</h1>
  <div class="curso-card-title">Diplomatura en Enfermería Escolar</div>
  <div class="curso-card-title">Diplomatura en Anestesia y Cirugía para Enfermería</div>
  <div class="curso-card-title">Curso Dolor en Pediatría</div>
`;

const response = (text) => ({ provider: 'test-agent', model: 'test-model', generate: async () => text });

async function run() {
  const retriever = createOfficialSourceRetriever({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => catalogHtml }),
    cacheTtlMs: 0,
  });
  const source = await retriever({ intent: 'EXPLORE_OPTIONS' });
  assert.equal(source.status, 'VERIFIED');
  assert.equal(source.source_used, true);
  assert.equal(source.source_url, PRIMARY_SOURCE_URL);
  assert.equal(source.catalog_items.length, 3);
  assert.match(source.evidence, /Enfermería Escolar/);

  const result = await resolveConversationalResponse(createSession({ started: true }), '¿Qué capacitaciones tienen?', {
    channel: 'whatsapp',
    external_sender_id: 'explore-quality',
    stateStore: new MemoryConversationStateStore(),
    sourceRetriever: async () => source,
    modelProvider: response('Sí: Enfermería Escolar, Anestesia y Cirugía y Dolor en Pediatría. ¿Qué área te interesa?'),
  });
  assert.equal(result.response_mode, 'AGENT');
  assert.equal(result.grounding_status, 'VERIFIED');
  assert.equal(result.selected_skill, 'OMEGA_ADMISSIONS');
  assert.equal(result.skill_executed, true);
  assert.match(result.text, /Enfermería Escolar/);

  for (const query of [
    '¿Qué capacitaciones tienen?',
    '¿Qué cursos ofrecen?',
    'Trabajo en guardia, ¿qué podría estudiar?',
    '¿Tienen algo de pediatría?',
    '¿Qué diplomaturas tienen?',
  ]) assert.equal(detectIntent(query, { current_course: null }), 'EXPLORE_OPTIONS', query);

  const irrelevant = createOfficialSourceRetriever({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<h1>Campus Profesional</h1>' }),
    cacheTtlMs: 0,
  });
  const insufficient = await irrelevant({ intent: 'EXPLORE_OPTIONS' });
  assert.equal(insufficient.status, 'INSUFFICIENT');
  assert.equal(insufficient.source_used, false);

  const malformed = await resolveConversationalResponse(createSession({ started: true }), '¿Qué capacitaciones tienen?', {
    channel: 'whatsapp',
    external_sender_id: 'format-quality',
    stateStore: new MemoryConversationStateStore(),
    sourceRetriever: async () => source,
    modelProvider: response('*Sí: Enfermería Escolar.**'),
  });
  assert.equal(malformed.text.includes('*'), false);

  console.log('OMEGA explore options quality: PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
