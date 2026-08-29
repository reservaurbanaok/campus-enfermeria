'use strict';

const { TABLE } = require('./commercial-event-store');

const PROJECTION_VERSION = 'retention-eligibility-v1';
const MAX_ROWS = 500;
const LIFECYCLE_EVENT_TYPES = new Set([
  'identity_verified', 'enrollment_started', 'enrollment_completed',
  'onboarding_started', 'netroom_access_ready', 'netroom_ready',
  'netroom_first_login', 'course_completed', 'retention_interaction',
  'enrollment_cancelled', 'enrollment_withdrawn', 'enrollment_revoked',
]);
const PROSPECT_EVENT_TYPES = new Set([
  'conversation_started', 'identity_provided', 'intent_detected',
  'profile_qualified', 'course_viewed', 'course_asked', 'course_recommended',
  'price_asked', 'certification_asked', 'modality_asked', 'duration_asked',
  'requirement_asked', 'objection_detected', 'objection_resolved',
  'human_requested', 'handoff_created', 'course_list_asked',
  'enrollment_intent_detected',
]);
const INCOMPATIBLE_ENROLLMENT_STATUSES = new Set(['cancelled', 'withdrawn', 'revoked']);

function asRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object' && !isTestEvent(row));
}

function metadata(row) {
  if (!row || !row.metadata_json) return {};
  if (typeof row.metadata_json === 'string') {
    try { return JSON.parse(row.metadata_json) || {}; } catch { return {}; }
  }
  return row.metadata_json;
}

function isTestEvent(row) {
  return metadata(row).test_event === true;
}

function authorizedLifecycle(row) {
  const detail = metadata(row);
  if (detail.authorized === false || detail.authorization === false) return false;
  if (row?.event_type === 'course_completed' && String(detail.completion_status || '').toLowerCase() !== 'completed') return false;
  return true;
}

function safeEvidence(row) {
  return {
    event_id: row.event_id || null,
    event_type: row.event_type || null,
    event_timestamp: row.event_timestamp || row.timestamp || null,
    course_id: row.course_id || null,
  };
}

function sortEvidence(rows) {
  return rows.map(safeEvidence).sort((a, b) => String(a.event_timestamp || '').localeCompare(String(b.event_timestamp || '')));
}

function allowedPersonReference(rows) {
  const value = rows.map((row) => row.person_or_anonymous_id).find((item) => typeof item === 'string' && item.startsWith('sha256:'));
  return value || null;
}

function lifecycleConflict(rows) {
  const statuses = new Set();
  for (const row of rows) {
    const detail = metadata(row);
    const status = typeof detail.enrollment_status === 'string' ? detail.enrollment_status.trim().toLowerCase() : null;
    if (status) statuses.add(status);
    if (INCOMPATIBLE_ENROLLMENT_STATUSES.has(row.event_type)) statuses.add(row.event_type.replace('enrollment_', ''));
  }
  const hasIncompatible = [...statuses].some((status) => INCOMPATIBLE_ENROLLMENT_STATUSES.has(status));
  const hasActive = [...statuses].some((status) => ['active', 'enrolled', 'onboarding', 'completed'].includes(status));
  return hasIncompatible && hasActive;
}

function eventTime(row) {
  const value = Date.parse(row?.event_timestamp || row?.timestamp || '');
  return Number.isNaN(value) ? null : value;
}

function orderedBefore(rows, eventType, predecessorTypes) {
  const target = rows.filter((row) => row.event_type === eventType).sort((a, b) => (eventTime(b) || 0) - (eventTime(a) || 0))[0];
  if (!target) return false;
  const targetTime = eventTime(target);
  return predecessorTypes.every((types) => rows.some((row) => {
    if (!types.includes(row.event_type)) return false;
    const predecessorTime = eventTime(row);
    return targetTime === null || predecessorTime === null || predecessorTime <= targetTime;
  }));
}

function baseProjection(rows, status, currentLifecycleState, reasonCodes) {
  return {
    status,
    person_id_if_allowed: allowedPersonReference(rows),
    current_lifecycle_state: currentLifecycleState,
    evidence_events: sortEvidence(rows),
    reason_codes: reasonCodes,
    evaluated_at: new Date().toISOString(),
    projection_version: PROJECTION_VERSION,
  };
}

function projectRetentionEligibility(inputRows) {
  const rows = asRows(inputRows);
  const lifecycleRows = rows.filter((row) => LIFECYCLE_EVENT_TYPES.has(row.event_type) && authorizedLifecycle(row));
  const prospectRows = rows.filter((row) => PROSPECT_EVENT_TYPES.has(row.event_type));
  const evidenceRows = [...lifecycleRows, ...prospectRows];

  if (!rows.length) return baseProjection([], 'INSUFFICIENT_DATA', 'UNKNOWN', ['NO_EVIDENCE']);
  if (lifecycleConflict(lifecycleRows)) {
    return baseProjection(evidenceRows, 'HUMAN_REVIEW_REQUIRED', 'CONFLICTED', ['CONFLICTING_LIFECYCLE_EVIDENCE']);
  }
  if (!lifecycleRows.length) {
    if (prospectRows.length) return baseProjection(prospectRows, 'NOT_RETENTION_ELIGIBLE', 'PROSPECT', ['PROSPECT_STAGE', 'NO_LIFECYCLE_EVIDENCE']);
    return baseProjection([], 'INSUFFICIENT_DATA', 'UNKNOWN', ['NO_AUTHORIZED_LIFECYCLE_EVIDENCE']);
  }

  const hasEnrollment = lifecycleRows.some((row) => row.event_type === 'enrollment_completed');
  const hasOnboarding = lifecycleRows.some((row) => row.event_type === 'onboarding_started');
  const hasReady = lifecycleRows.some((row) => ['netroom_access_ready', 'netroom_ready'].includes(row.event_type));
  if (hasOnboarding && !hasEnrollment) return baseProjection(evidenceRows, 'HUMAN_REVIEW_REQUIRED', 'CONFLICTED', ['ONBOARDING_WITHOUT_ENROLLMENT']);
  if (hasReady && !hasEnrollment) return baseProjection(evidenceRows, 'HUMAN_REVIEW_REQUIRED', 'CONFLICTED', ['NETROOM_READY_WITHOUT_ENROLLMENT']);
  if (hasReady && !hasOnboarding) return baseProjection(evidenceRows, 'HUMAN_REVIEW_REQUIRED', 'CONFLICTED', ['NETROOM_READY_BEFORE_ONBOARDING']);

  const hasOrderedCompletion = orderedBefore(lifecycleRows, 'course_completed', [
    ['enrollment_completed'], ['onboarding_started'], ['netroom_access_ready', 'netroom_ready'],
  ]);
  const hasCompletion = lifecycleRows.some((row) => row.event_type === 'course_completed');
  if (hasCompletion && !hasOrderedCompletion) {
    return baseProjection(evidenceRows, 'HUMAN_REVIEW_REQUIRED', 'CONFLICTED', ['COMPLETION_WITHOUT_ORDERED_NETROOM_READY']);
  }
  if (hasOrderedCompletion) {
    return baseProjection(evidenceRows, 'NEXT_COURSE_EVALUATION_ELIGIBLE', 'COMPLETED', ['EXPLICIT_COURSE_COMPLETION']);
  }
  if (lifecycleRows.some((row) => row.event_type === 'netroom_first_login')) {
    return baseProjection(evidenceRows, 'RETENTION_ELIGIBLE', 'STUDENT', ['STUDENT_LIFECYCLE_EVIDENCE', 'NO_COURSE_COMPLETION']);
  }
  if (lifecycleRows.some((row) => ['netroom_access_ready', 'netroom_ready'].includes(row.event_type))) {
    return baseProjection(evidenceRows, 'RETENTION_ELIGIBLE', 'NETROOM_READY', ['NETROOM_READY_LIFECYCLE_EVIDENCE', 'NO_COURSE_COMPLETION']);
  }
  if (lifecycleRows.some((row) => row.event_type === 'onboarding_started')) {
    return baseProjection(evidenceRows, 'RETENTION_ELIGIBLE', 'ONBOARDING', ['ONBOARDING_LIFECYCLE_EVIDENCE', 'NO_COURSE_COMPLETION']);
  }
  if (lifecycleRows.some((row) => row.event_type === 'enrollment_completed')) {
    return baseProjection(evidenceRows, 'RETENTION_ELIGIBLE', 'ENROLLED', ['ENROLLMENT_LIFECYCLE_EVIDENCE', 'NO_COURSE_COMPLETION']);
  }
  if (lifecycleRows.some((row) => row.event_type === 'enrollment_started')) {
    return baseProjection(evidenceRows, 'INSUFFICIENT_DATA', 'ENROLLMENT_PENDING', ['ENROLLMENT_NOT_COMPLETED']);
  }
  if (lifecycleRows.some((row) => row.event_type === 'identity_verified')) {
    return baseProjection(evidenceRows, 'INSUFFICIENT_DATA', 'IDENTITY_VERIFIED', ['LIFECYCLE_STATE_INCOMPLETE']);
  }
  return baseProjection(evidenceRows, 'INSUFFICIENT_DATA', 'UNKNOWN', ['LIFECYCLE_STATE_INCOMPLETE']);
}

function selectorFromInput(input = {}) {
  const conversationId = input.conversation_id ? String(input.conversation_id).trim() : '';
  const personId = input.person_id ? String(input.person_id).trim() : '';
  if (!conversationId && !personId) throw new Error('selector_required');
  if (conversationId.length > 200 || personId.length > 200) throw new Error('selector_invalid');
  if (personId && !personId.startsWith('sha256:')) throw new Error('person_reference_invalid');
  return { conversation_id: conversationId || null, person_id: personId || null };
}

async function readAuthorizedLifecycleEvents(db, input = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('database_unconfigured');
  const selector = selectorFromInput(input);
  const result = await db.query(
    `SELECT event_id,event_type,schema_version,event_timestamp,conversation_id,person_or_anonymous_id,course_id,metadata_json
     FROM ${TABLE}
     WHERE ($1::text IS NULL OR conversation_id = $1)
       AND ($2::text IS NULL OR person_or_anonymous_id = $2)
       AND metadata_json->>'test_event' IS DISTINCT FROM 'true'
     ORDER BY event_timestamp ASC LIMIT ${MAX_ROWS}`,
    [selector.conversation_id, selector.person_id],
  );
  return result.rows || [];
}

async function getRetentionEligibility(db, input = {}) {
  const rows = await readAuthorizedLifecycleEvents(db, input);
  return projectRetentionEligibility(rows);
}

module.exports = {
  PROJECTION_VERSION,
  LIFECYCLE_EVENT_TYPES,
  projectRetentionEligibility,
  selectorFromInput,
  readAuthorizedLifecycleEvents,
  getRetentionEligibility,
  isTestEvent,
};
