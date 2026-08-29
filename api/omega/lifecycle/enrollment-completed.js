'use strict';

const crypto = require('crypto');
const { courses } = require('../../../core/omega-concierge-core');
const { normalizeCourseId, normalizeEvent, appendEvents } = require('../../_lib/commercial-event-store');
const { projectRetentionEligibility } = require('../../_lib/retention-eligibility-projector');

const EVENT_TYPE = 'enrollment_completed';
const SOURCE = 'gate06_enrollment_bridge';
const CHANNEL = 'campus_web';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 300;
const ALLOWED_FIELDS = new Set(['event_type', 'event_id', 'timestamp', 'course_id', 'person_id', 'conversation_id', 'correlation_id']);
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

function timingSafeHex(expected, supplied) {
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
}

function verifySignature(rawBody, req, secret) {
  const timestamp = String(header(req, 'x-omega-timestamp')).trim();
  const nonce = String(header(req, 'x-omega-nonce')).trim();
  const supplied = String(header(req, 'x-omega-signature')).trim().toLowerCase();
  const timestampNumber = Number(timestamp);
  if (!secret || !timestamp || !nonce || !Number.isInteger(timestampNumber)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > MAX_CLOCK_SKEW_SECONDS) return false;
  const signingInput = `${timestamp}\n${nonce}\n`;
  const expected = crypto.createHmac('sha256', secret).update(signingInput).update(rawBody).digest('hex');
  return timingSafeHex(expected, supplied);
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

function validateMinimalPayload(payload, idempotencyKey) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload_invalid');
  if (Object.keys(payload).some((key) => !ALLOWED_FIELDS.has(key))) throw new Error('payload_fields_not_allowed');
  if (payload.event_type !== EVENT_TYPE) throw new Error('event_type_invalid');
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
  return {
    item: {
      event_type: EVENT_TYPE,
      event_id: eventId,
      timestamp: timestamp.toISOString(),
      course_id: courseId,
      metadata_json: { authorized: true, enrollment_status: 'completed' },
    },
    context: {
      channel: CHANNEL,
      conversation_id: conversationId,
      person_or_anonymous_id: personId,
      correlation_id: correlationId,
      source: SOURCE,
    },
  };
}

async function acceptAuthorizedEnrollmentConfirmation(db, payload, idempotencyKey) {
  const normalized = validateMinimalPayload(payload, idempotencyKey);
  const event = normalizeEvent(normalized.item, normalized.context);
  const result = await appendEvents(db, normalized.item, normalized.context);
  const projection = projectRetentionEligibility([event]);
  return {
    inserted: result.inserted === 1,
    deduplicated: result.inserted === 0,
    event_type: EVENT_TYPE,
    schema_version: event.schema_version,
    lifecycle_state: projection.current_lifecycle_state,
    retention_status: projection.status,
  };
}

function createEnrollmentCompletedHandler(options = {}) {
  const database = options.database || (() => require('../../_lib/db').getDatabase());
  const secret = options.secret || (() => process.env.CAMPUS_GATE06_ENROLLMENT_BRIDGE_SECRET || '');
  return async function enrollmentCompleted(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const configuredSecret = secret();
    if (!configuredSecret) return json(res, 503, { error: 'enrollment_bridge_unavailable' });
    let rawBody;
    try {
      rawBody = await readBody(req);
      if (!verifySignature(rawBody, req, configuredSecret)) return json(res, 401, { error: 'unauthorized' });
      const payload = JSON.parse(rawBody.toString('utf8'));
      const result = await acceptAuthorizedEnrollmentConfirmation(database(), payload, header(req, 'x-omega-idempotency-key'));
      return json(res, 200, result);
    } catch (error) {
      const validationErrors = new Set([
        'body_too_large', 'payload_invalid', 'payload_fields_not_allowed', 'event_type_invalid',
        'event_id_invalid', 'idempotency_key_invalid', 'event_timestamp_invalid', 'course_id_invalid',
        'person_id_invalid', 'person_reference_invalid', 'conversation_id_invalid',
        'correlation_id_invalid', 'identity_reference_required',
      ]);
      return json(res, validationErrors.has(error?.message) ? 422 : 503, { error: validationErrors.has(error?.message) ? 'invalid_enrollment_confirmation' : 'enrollment_event_unavailable' });
    }
  };
}

module.exports = createEnrollmentCompletedHandler();
module.exports.createEnrollmentCompletedHandler = createEnrollmentCompletedHandler;
module.exports.acceptAuthorizedEnrollmentConfirmation = acceptAuthorizedEnrollmentConfirmation;
module.exports.verifySignature = verifySignature;
