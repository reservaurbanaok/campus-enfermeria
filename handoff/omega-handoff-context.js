'use strict';

const BLOCKED_KEYS = new Set(['academic_progress', 'lessons', 'evaluations', 'attempts', 'grades', 'netroom_private', 'private_netroom_data', 'secret', 'secrets', 'password', 'token', 'raw_transcript', 'transcript']);

function cleanValue(value) {
  if (Array.isArray(value)) return value.map(cleanValue).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (!BLOCKED_KEYS.has(key.toLowerCase())) output[key] = cleanValue(item);
  }
  return output;
}

function buildHandoffContext(input = {}, decision = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const identity = input.identity || {};
  const course = input.active_course || null;
  const context = {
    schema_version: 'omega-handoff-context-v1',
    handoff_id: options.handoff_id || input.handoff_id || `handoff-${input.conversation_id || 'unknown'}-${Date.now()}`,
    conversation_id: input.conversation_id,
    created_at: input.created_at || now,
    updated_at: now,
    anonymous_id: identity.anonymous_id ?? null,
    person_id_if_allowed: identity.person_id_if_allowed ?? null,
    name_if_known: identity.name_if_known ?? null,
    verified_identity_status: identity.verified_identity_status === 'verified' ? 'verified' : (identity.verified_identity_status === 'unverified' ? 'unverified' : 'unknown'),
    contact_if_authorized: identity.contact_if_authorized ?? null,
    channel: input.channel || 'campus_web',
    channel_conversation_reference: input.channel_conversation_reference ?? null,
    adapter_metadata: cleanValue(input.adapter_metadata || {}),
    detected_intent: input.detected_intent ?? null,
    active_course: course ? { course_id: course.course_id, slug: course.slug, public_name: course.public_name } : null,
    profile_summary: input.profile_summary ?? null,
    commercial_intent_level: input.commercial_intent_level ?? null,
    commercial_intent_confidence: input.commercial_intent_confidence ?? null,
    questions_asked: cleanValue(input.questions_asked || []),
    relevant_answers: cleanValue(input.relevant_answers || []),
    objections: cleanValue(input.objections || []),
    unresolved_items: cleanValue(input.unresolved_items || []),
    actions_taken: cleanValue(input.actions_taken || []),
    trigger_code: decision.trigger_code ?? null,
    handoff_reason_summary: decision.reason || '',
    required_human_capability: decision.required_human_capability ?? null,
    priority: decision.priority || 'medium',
    recommended_next_action: decision.recommended_next_action ?? null,
    allowed_data_scope: cleanValue(input.allowed_data_scope || []),
    excluded_data_domains: Array.from(new Set(['NETROOM_PRIVATE', ...(input.excluded_data_domains || [])])),
    consent_or_authorization_if_required: input.consent_or_authorization_if_required ?? null,
    transcript_reference: input.transcript_reference ?? null,
    source_references: cleanValue(input.source_references || [])
  };
  return cleanValue(context);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { buildHandoffContext };
if (typeof window !== 'undefined') window.omegaHandoffContext = { buildHandoffContext };
