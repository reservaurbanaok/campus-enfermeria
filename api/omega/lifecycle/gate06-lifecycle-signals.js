'use strict';

const crypto = require('crypto');
const { courses } = require('../../../core/omega-concierge-core');
const { TABLE, normalizeCourseId, normalizeEvent, appendEvents } = require('../../_lib/commercial-event-store');
const { projectRetentionEligibility } = require('../../_lib/retention-eligibility-projector');

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 300;
const CHANNEL = 'campus_web';
const EVENT_TYPES = new Set(['onboarding_started', 'netroom_access_ready', 'course_completed']);
const ALLOWED_FIELDS = new Set(['event_type', 'event_id', 'timestamp', 'course_id', 'person_id', 'conversation_id', 'correlation_id', 'onboarding_status', 'access_status', 'completion_status']);
const CANONICAL_COURSE_IDS = new Set(courses.flatMap((course) => [course.key, course.slug]).filter(Boolean));

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function header(req, name) {
  const wanted = name.toLowerCase();
  return Object.entries(req.headers || {}).find(([key]) => key.toLowerCase() === wanted)?.[1] || '';
}

async function readBody(req) {
  if (req.body !== undefined) return Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body));
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY_BYTES) throw new Error('body_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function verifySignature(rawBody, req, secret) {
  const timestamp = String(header(req, 'x-omega-timestamp')).trim();
  const nonce = String(header(req, 'x-omega-nonce')).trim();
  const supplied = String(header(req, 'x-omega-signature')).trim().toLowerCase();
  const timestampNumber = Number(timestamp);
  if (!secret || !timestamp || !nonce || !Number.isInteger(timestampNumber)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > MAX_CLOCK_SKEW_SECONDS) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n`).update(rawBody).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
}

function opaque(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || /\s/.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function authorizedPersonReference(value) {
  const normalized = opaque(value, 'person_id');
  if (/@/.test(normalized) || /^\+?\d{7,}$/.test(normalized) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(normalized)) throw new Error('person_reference_invalid');
  return normalized;
}

function validatePayload(payload, idempotencyKey) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload_invalid');
  if (Object.keys(payload).some((key) => !ALLOWED_FIELDS.has(key))) throw new Error('payload_fields_not_allowed');
  if (!EVENT_TYPES.has(payload.event_type)) throw new Error('event_type_invalid');
  const eventId = opaque(payload.event_id, 'event_id');
  if (!idempotencyKey || String(idempotencyKey).trim() !== eventId) throw new Error('idempotency_key_invalid');
  const timestamp = new Date(payload.timestamp);
  if (Number.isNaN(timestamp.getTime())) throw new Error('event_timestamp_invalid');
  const courseId = normalizeCourseId(payload.course_id);
  if (!courseId || !CANONICAL_COURSE_IDS.has(courseId)) throw new Error('course_id_invalid');
  const personId = payload.person_id === undefined ? null : authorizedPersonReference(payload.person_id);
  const conversationId = payload.conversation_id === undefined ? null : opaque(payload.conversation_id, 'conversation_id');
  const correlationId = opaque(payload.correlation_id, 'correlation_id');
  if (!personId && !conversationId) throw new Error('identity_reference_required');
  if (payload.event_type === 'onboarding_started' && String(payload.onboarding_status || '').toUpperCase() !== 'STARTED') throw new Error('onboarding_status_invalid');
  if (payload.event_type === 'netroom_access_ready' && String(payload.access_status || '').toUpperCase() !== 'READY') throw new Error('access_status_invalid');
  if (payload.event_type === 'course_completed' && String(payload.completion_status || '').toUpperCase() !== 'COMPLETED') throw new Error('completion_status_invalid');
  return { eventId, timestamp: timestamp.toISOString(), courseId, personId, conversationId, correlationId, eventType: payload.event_type, completionStatus: payload.completion_status };
}

function personReferenceHash(value) {
  return value ? `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}` : null;
}

async function readRelatedEvents(db, value) {
  const personHash = personReferenceHash(value.personId);
  const result = await db.query(
    `SELECT event_id,event_type,schema_version,event_timestamp,conversation_id,person_or_anonymous_id,course_id,metadata_json
     FROM ${TABLE}
     WHERE (($1::text IS NOT NULL AND conversation_id = $1)
        OR ($2::text IS NOT NULL AND person_or_anonymous_id = $2))
       AND metadata_json->>'test_event' IS DISTINCT FROM 'true'
     ORDER BY event_timestamp ASC LIMIT 500`,
    [value.conversationId, personHash],
  );
  return result.rows || [];
}

function hasEvent(rows, eventType) { return rows.some((row) => row.event_type === eventType); }

async function acceptAuthorizedLifecycleSignal(db, payload, idempotencyKey) {
  const value = validatePayload(payload, idempotencyKey);
  const related = await readRelatedEvents(db, value);
  if (value.eventType === 'onboarding_started' && !hasEvent(related, 'enrollment_completed')) throw new Error('enrollment_precondition_required');
  if (value.eventType === 'netroom_access_ready' && (!hasEvent(related, 'enrollment_completed') || !hasEvent(related, 'onboarding_started'))) throw new Error('onboarding_precondition_required');
  if (value.eventType === 'course_completed' && (!hasEvent(related, 'enrollment_completed') || !hasEvent(related, 'onboarding_started') || !hasEvent(related, 'netroom_access_ready'))) throw new Error('completion_precondition_required');
  const source = value.eventType === 'onboarding_started' ? 'gate06_onboarding_bridge' : value.eventType === 'netroom_access_ready' ? 'gate06_identity_bridge' : 'gate06_completion_bridge';
  const item = {
    event_type: value.eventType,
    event_id: value.eventId,
    timestamp: value.timestamp,
    course_id: value.courseId,
    metadata_json: value.eventType === 'onboarding_started'
      ? { authorized: true, onboarding_status: 'started' }
      : value.eventType === 'netroom_access_ready'
        ? { authorized: true, access_status: 'ready' }
        : { authorized: true, completion_status: 'completed' },
  };
  const context = {
    channel: CHANNEL,
    conversation_id: value.conversationId,
    person_or_anonymous_id: value.personId,
    correlation_id: value.correlationId,
    source,
  };
  const event = normalizeEvent(item, context);
  const result = await appendEvents(db, item, context);
  const projectionRows = [...related.filter((row) => row.event_id !== event.event_id), event];
  const projection = projectRetentionEligibility(projectionRows);
  return {
    inserted: result.inserted === 1,
    deduplicated: result.inserted === 0,
    event_type: value.eventType,
    schema_version: event.schema_version,
    lifecycle_state: projection.current_lifecycle_state,
    retention_status: projection.status,
  };
}

function createLifecycleSignalsHandler(options = {}) {
  const database = options.database || (() => require('../../_lib/db').getDatabase());
  const secret = options.secret || (() => process.env.CAMPUS_GATE06_ENROLLMENT_BRIDGE_SECRET || '');
  return async function lifecycleSignals(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const configuredSecret = secret();
    if (!configuredSecret) return json(res, 503, { error: 'lifecycle_bridge_unavailable' });
    try {
      const rawBody = await readBody(req);
      if (!verifySignature(rawBody, req, configuredSecret)) return json(res, 401, { error: 'unauthorized' });
      const payload = JSON.parse(rawBody.toString('utf8'));
      return json(res, 200, await acceptAuthorizedLifecycleSignal(database(), payload, header(req, 'x-omega-idempotency-key')));
    } catch (error) {
      const clientErrors = new Set([
        'body_too_large', 'payload_invalid', 'payload_fields_not_allowed', 'event_type_invalid',
        'event_id_invalid', 'idempotency_key_invalid', 'event_timestamp_invalid', 'course_id_invalid',
        'person_id_invalid', 'person_reference_invalid', 'conversation_id_invalid', 'correlation_id_invalid',
        'identity_reference_required', 'onboarding_status_invalid', 'access_status_invalid', 'completion_status_invalid',
      ]);
      if (error?.message === 'enrollment_precondition_required' || error?.message === 'onboarding_precondition_required' || error?.message === 'completion_precondition_required') return json(res, 409, { error: 'lifecycle_precondition_failed' });
      return json(res, clientErrors.has(error?.message) ? 422 : 503, { error: clientErrors.has(error?.message) ? 'invalid_lifecycle_signal' : 'lifecycle_event_unavailable' });
    }
  };
}

module.exports = createLifecycleSignalsHandler();
module.exports.createLifecycleSignalsHandler = createLifecycleSignalsHandler;
module.exports.acceptAuthorizedLifecycleSignal = acceptAuthorizedLifecycleSignal;
module.exports.validatePayload = validatePayload;
