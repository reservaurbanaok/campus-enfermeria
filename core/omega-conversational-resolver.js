'use strict';

const { shouldHandoff } = require('./omega-concierge-core');
const { appendTurn, conversationKey, createConversationState, defaultConversationStateStore } = require('./omega-conversation-state');
const { defaultOfficialSourceRetriever } = require('./omega-official-source');
const { executeAdmissions } = require('./omega-admissions');
const { SYSTEM_PROMPT, SYSTEM_PROMPT_SOURCE } = require('./omega-agent-system-prompt');
const { createConfiguredModelProvider } = require('./omega-model-provider');

const COMMERCIAL_INTENTS = new Set(['ASK_RECOMMENDATION', 'COMPARE_COURSES', 'EXPLORE_OPTIONS', 'ENROLLMENT_INTENT', 'COURSE_QUESTION', 'PRICE', 'DURATION', 'MODALITY', 'CERTIFICATION', 'REQUIREMENTS', 'PROMOTION', 'OBJECTION']);
const COURSE_ALIASES = [
  { key: 'cuidados_criticos_emergencias', aliases: ['cuidados críticos', 'cuidados criticos', 'emergencias', 'terapia intensiva', 'cuidados'] },
  { key: 'anestesia', aliases: ['anestesia', 'cirugía', 'cirugia'] },
  { key: 'escolar', aliases: ['enfermería escolar', 'enfermeria escolar', 'escolar'] },
];

function event(name, detail) { return detail === undefined ? { name } : { name, detail }; }
function normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function detectCourse(text) { const q = normalize(text); return COURSE_ALIASES.find((course) => course.aliases.some((alias) => q.includes(normalize(alias))))?.key || null; }

function detectIntent(text, state) {
  const q = normalize(text);
  if (/hablar con (alguien|una persona|un humano)|persona real|operador|asesor/.test(q)) return 'HANDOFF_REQUEST';
  if (/recomend|que me conviene|qué me conviene|orient/.test(q)) return 'ASK_RECOMMENDATION';
  if (/compar|diferencia|entre .* y /.test(q)) return 'COMPARE_COURSES';
  if (/que cursos|qué cursos|que capacit|qué capacit|opciones|oferta/.test(q)) return 'EXPLORE_OPTIONS';
  if (/inscrib|anotar|cursar|formulario/.test(q)) return 'ENROLLMENT_INTENT';
  if (/precio|costo|valor|cuanto cuesta|cuánto cuesta|cuanto sale|cuánto sale|cuotas|pago/.test(q)) return 'PRICE';
  if (/durac|cuanto dura|cuánto dura/.test(q)) return 'DURATION';
  if (/modal|online|zoom|virtual|presencial/.test(q)) return 'MODALITY';
  if (/certif|aval|resolucion|resolución/.test(q)) return 'CERTIFICATION';
  if (/requisit|dirigido a|quien puede|quién puede/.test(q)) return 'REQUIREMENTS';
  if (/promoc|descuento|off|bonific|forma de pago/.test(q)) return 'PROMOTION';
  if (/caro|costos|costoso|mucho dinero|no puedo pagar/.test(q)) return 'OBJECTION';
  if (detectCourse(text) || state.current_course) return 'COURSE_QUESTION';
  return 'GENERAL';
}

function safeFallback(intent, state, admissions, source) {
  if (intent === 'PRICE' || intent === 'OBJECTION') return source.status === 'VERIFIED' && source.required_fact_found ? 'Puedo orientarte con el valor publicado en la fuente oficial. Si querés confirmar vigencia o medios de pago, corresponde completar el formulario oficial.' : 'No puedo confirmar el valor o una promoción porque no está disponible en la fuente oficial en este momento. Puedo derivarte al Campus para confirmarlo.';
  if (intent === 'DURATION' || intent === 'MODALITY' || intent === 'CERTIFICATION' || intent === 'REQUIREMENTS' || intent === 'PROMOTION') return source.status === 'VERIFIED' && source.required_fact_found ? 'Encontré información oficial sobre esa capacitación. Si querés, te indico el dato puntual publicado y el formulario oficial.' : 'No puedo confirmar ese dato porque no está disponible en la fuente oficial en este momento. Puedo derivarte al Campus para confirmarlo.';
  if (admissions?.needs_clarification) return 'Para recomendarte una capacitación necesito conocer qué área te interesa, tu experiencia y qué objetivo buscás.';
  if (intent === 'ENROLLMENT_INTENT') return state.current_course ? 'Puedo acercarte el formulario oficial de la capacitación que estás evaluando. La apertura del formulario no confirma una inscripción completada.' : '¿Qué capacitación te interesa para acercarte el formulario oficial correspondiente?';
  if (intent === 'EXPLORE_OPTIONS') return source.status === 'VERIFIED' ? 'La oferta publicada está disponible para revisarla según tu área, experiencia y objetivo. ¿Qué te interesa desarrollar?' : 'Puedo orientarte sobre capacitaciones, pero necesito consultar la fuente oficial antes de afirmar qué opciones están vigentes. ¿Qué área te interesa?';
  return 'Puedo ayudarte a evaluar capacitaciones del Campus con información oficial. ¿Qué área o capacitación estás considerando?';
}

function containsUnsupportedCommercialClaim(text, source) {
  const output = normalize(text);
  const sourceText = normalize(source?.evidence || '');
  const factSignals = [
    /\$\s?[0-9][0-9.,]*/, /\b[0-9]+\s+mes/, /\b(?:inicio|fecha|comienza|empieza)\b/, /\bmodalidad\b|\bonline\b|\bzoom\b|\bvirtual\b/,
    /\bcertific|\baval/, /\brequisit|\bdirigido a/, /\bpromoci|\bdescuento|\boff\b/, /\bformulario oficial\b|\binscrib/,
  ];
  if (source.status !== 'VERIFIED') return factSignals.some((signal) => signal.test(output));
  const monetary = String(text).match(/\$\s?[0-9][0-9.,]*/g) || [];
  if (monetary.some((value) => !sourceText.includes(normalize(value)))) return true;
  const duration = output.match(/\b[0-9]+\s+mes(?:es)?\b/g) || [];
  if (duration.some((value) => !sourceText.includes(value))) return true;
  return factSignals.slice(2).some((signal) => signal.test(output) && !signal.test(sourceText));
}

async function resolveConversationalResponse(session, text, options = {}) {
  const channel = options.channel || 'unknown';
  const externalSenderId = options.external_sender_id || options.channel_conversation_reference || session?.conversation_id;
  const key = conversationKey(channel, externalSenderId);
  const store = options.stateStore || defaultConversationStateStore;
  let state = await store.load(key);
  if (!state) state = createConversationState({ channel, external_sender_id: externalSenderId, conversation_id: session?.conversation_id || `omega-${Date.now()}` });
  state = appendTurn(state, 'user', text, options.timestamp);
  const course = detectCourse(text) || state.current_course;
  const intent = detectIntent(text, state);
  state.current_course = course;
  state.current_intent = intent;
  state.unresolved_question = COMMERCIAL_INTENTS.has(intent) && !course ? String(text || '').slice(0, 500) : null;
  const events = [event('intent_detected', intent), event('conversation_state_updated', { current_course: course, current_intent: intent, recent_turns: state.raw_recent_turns.length })];
  const compatibilityEvents = { EXPLORE_OPTIONS: 'course_list_asked', PRICE: 'price_asked', CERTIFICATION: 'certification_asked', DURATION: 'duration_asked', MODALITY: 'modality_asked', ENROLLMENT_INTENT: 'enrollment_intent_detected', OBJECTION: 'objection_detected' };
  if (compatibilityEvents[intent]) events.push(event(compatibilityEvents[intent], course || undefined));
  const handoffDecision = shouldHandoff({ query: normalize(text) });
  if (handoffDecision.should_handoff || intent === 'HANDOFF_REQUEST') {
    state.handoff_state = 'requested';
    await store.save(key, state);
    const handoffId = session?.handoff_id || options.handoff_id || `handoff-${state.conversation_id}-${Date.now()}`;
    events.push(event('handoff_created', { handoff_id: handoffId, trigger_code: handoffDecision.trigger_code || 'USER_REQUESTED_HUMAN' }));
    console.log(JSON.stringify({ event: 'omega_semantic_response', channel, response_mode: 'HANDOFF', selected_skill: null, skill_executed: false, grounding_status: 'INSUFFICIENT', source_used: false, source_url: null, source_timestamp_present: false, model_provider: 'none', model_name: 'none' }));
    return { response_type: 'handoff', text: 'Tu solicitud quedó preparada para atención humana.', events, response_mode: 'HANDOFF', selected_skill: null, skill_executed: false, grounding_status: 'INSUFFICIENT', source_used: false, source_url: null, source_timestamp: null, handoff_input: { conversation_id: state.conversation_id, channel, channel_conversation_reference: options.channel_conversation_reference || null, adapter_metadata: options.adapter_metadata || {}, active_course: course ? { course_id: course, slug: course } : null, detected_intent: 'handoff_request', questions_asked: [String(text || '').slice(0, 500)], objections: [] }, handoff_decision: handoffDecision, handoff_id: handoffId };
  }
  const sourceRetriever = options.sourceRetriever || defaultOfficialSourceRetriever;
  const source = COMMERCIAL_INTENTS.has(intent) ? await sourceRetriever({ course, intent, text }) : { status: 'INSUFFICIENT', source_used: false, source_url: null, source_timestamp: null, required_fact_found: false, evidence: '' };
  const admissions = executeAdmissions({ intent, text, currentCourse: course, source });
  if (admissions.selected_skill) events.push(event('skill_selected', admissions.selected_skill));
  events.push(event('skill_execution', { selected_skill: admissions.selected_skill, skill_executed: admissions.skill_executed }));
  const developerPrompt = JSON.stringify({ intent, state: { current_course: state.current_course, current_intent: state.current_intent, unresolved_question: state.unresolved_question, raw_recent_turns: state.raw_recent_turns }, admissions: admissions.admissions_output, source: { status: source.status, source_used: source.source_used, source_url: source.source_url, source_timestamp: source.source_timestamp, evidence: source.evidence } });
  const provider = options.modelProvider === undefined ? createConfiguredModelProvider() : options.modelProvider;
  let responseMode = 'AGENT';
  let responseText = '';
  let modelError = null;
  if (provider && typeof provider.generate === 'function') {
    try { responseText = await provider.generate({ systemPrompt: SYSTEM_PROMPT, developerPrompt, userPrompt: String(text || '') }); }
    catch (error) { responseMode = 'DETERMINISTIC_FALLBACK'; modelError = error?.code || 'model_failed'; }
  } else {
    responseMode = 'DETERMINISTIC_FALLBACK';
    modelError = 'model_not_configured';
  }
  const guardFailed = responseMode === 'AGENT' && (COMMERCIAL_INTENTS.has(intent) && source.status !== 'VERIFIED' || containsUnsupportedCommercialClaim(responseText, source));
  if (!responseText || guardFailed) { responseMode = 'DETERMINISTIC_FALLBACK'; responseText = safeFallback(intent, state, admissions, source); events.push(event('grounding_guard_fallback', { reason: guardFailed ? 'unsupported_commercial_claim' : modelError || 'empty_model_response' })); }
  else events.push(event('grounding_guard_pass', { source_used: source.source_used, source_timestamp_present: Boolean(source.source_timestamp) }));
  state = appendTurn({ ...state, unresolved_question: admissions.needs_clarification ? String(text || '').slice(0, 500) : null }, 'assistant', responseText, options.timestamp);
  state.handoff_state = 'none';
  await store.save(key, state);
  console.log(JSON.stringify({
    event: 'omega_semantic_response',
    channel,
    response_mode: responseMode,
    selected_skill: admissions.selected_skill,
    skill_executed: admissions.skill_executed,
    grounding_status: source.status,
    source_used: source.source_used === true,
    source_url: source.source_url || null,
    source_timestamp_present: Boolean(source.source_timestamp),
    model_provider: provider?.provider || 'none',
    model_name: provider?.model || 'none',
  }));
  return { response_type: 'text', text: responseText, events, action: null, response_mode: responseMode, selected_skill: admissions.selected_skill, skill_executed: admissions.skill_executed, grounding_status: source.status, source_used: source.source_used, source_url: source.source_url, source_timestamp: source.source_timestamp, model_provider: provider?.provider || 'none', model_name: provider?.model || 'none', system_prompt_source: SYSTEM_PROMPT_SOURCE, conversation_history_used: state.raw_recent_turns.length > 1, state_key: key };
}

module.exports = { COMMERCIAL_INTENTS, detectIntent, detectCourse, containsUnsupportedCommercialClaim, resolveConversationalResponse };
