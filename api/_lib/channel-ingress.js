'use strict';

const crypto = require('crypto');
const { buildHandoffContext } = require('../../handoff/omega-handoff-context');
const { createHandoff } = require('../../handoff/omega-handoff-persistence');
const { createSession, respondToMessage } = require('../../core/omega-concierge-core');

const MAX_SKEW_SECONDS = 300;
const MAX_BODY_BYTES = 64 * 1024;

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function header(req, name) {
  const headers = req.headers || {};
  return String(headers[name.toLowerCase()] || headers[name] || '');
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readRawBody(req) {
  if (req.body !== undefined && req.body !== null) {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    if (body.length > MAX_BODY_BYTES) throw Object.assign(new Error('body_too_large'), { code: 'body_too_large' });
    return body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('body_too_large'), { code: 'body_too_large' });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function verifySignature(body, req, secret, now) {
  const service = header(req, 'x-omega-service');
  const timestamp = header(req, 'x-omega-timestamp');
  const nonce = header(req, 'x-omega-nonce');
  const supplied = header(req, 'x-omega-signature');
  if (!secret || service !== (process.env.OMEGA_CHANNEL_ALLOWED_SERVICE || 'n8n-whatsapp-staging') || !/^\d+$/.test(timestamp) || !nonce || !/^[a-f0-9]{64}$/i.test(supplied)) return { ok: false, code: 'invalid_signature' };
  const stamp = Number(timestamp);
  if (!Number.isSafeInteger(stamp) || Math.abs(now - stamp) > MAX_SKEW_SECONDS) return { ok: false, code: 'expired_timestamp' };
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n`).update(body).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'))) return { ok: false, code: 'invalid_signature' };
  return { ok: true, nonce, timestamp: stamp };
}

function validatePayload(payload, idempotencyKey) {
  if (!payload || payload.schema_version !== 'OMEGA_CHANNEL_MESSAGE_V1' || payload.channel !== 'whatsapp' || payload.message_type !== 'text' || typeof payload.external_message_id !== 'string' || typeof payload.external_actor_id !== 'string' || typeof payload.text !== 'string' || !payload.text.trim() || typeof payload.correlation_id !== 'string' || idempotencyKey !== payload.external_message_id) return false;
  return payload.text.length <= 500;
}

function conversationId(actor) { return `whatsapp-${hash(actor).slice(0, 32)}`; }

function createIngressHandler(options = {}) {
  const replay = options.replayStore || new Map();
  const now = options.now || (() => Math.floor(Date.now() / 1000));
  const persist = options.persistHandoff || (async (context) => {
    const { getDatabase } = require('./db');
    return createHandoff(getDatabase(), context);
  });
  return async function ingress(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    let body;
    try { body = await readRawBody(req); } catch (error) { return json(res, error.code === 'body_too_large' ? 413 : 400, { error: error.code || 'invalid_body' }); }
    const verified = verifySignature(body, req, process.env.OMEGA_CHANNEL_INGRESS_SECRET || '', now());
    if (!verified.ok) return json(res, 401, { error: verified.code });
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch { return json(res, 400, { error: 'malformed_message' }); }
    const idempotencyKey = header(req, 'x-omega-idempotency-key');
    if (!validatePayload(payload, idempotencyKey)) return json(res, 400, { error: 'malformed_message' });
    const digest = hash(body);
    const existing = replay.get(`idempotency:${idempotencyKey}`);
    const nonceKey = `nonce:${verified.nonce}`;
    if (replay.has(nonceKey)) return json(res, 409, { error: 'replay_detected' });
    replay.set(nonceKey, verified.timestamp + MAX_SKEW_SECONDS);
    for (const [key, expiry] of replay) if (typeof expiry === 'number' && expiry < now()) replay.delete(key);
    if (existing) {
      if (existing.digest !== digest) return json(res, 409, { error: 'idempotency_conflict' });
      return json(res, 200, { ...existing.response, deduplicated: true });
    }
    const session = createSession({ conversation_id: conversationId(payload.external_actor_id), started: true });
    const result = respondToMessage(session, payload.text, { channel: 'whatsapp', channel_conversation_reference: hash(payload.external_actor_id).slice(0, 32), adapter_metadata: { provider: 'meta_cloud_api' }, handoff_id: `handoff-${idempotencyKey}` });
    let handoff = null;
    if (result.handoff_input) {
      const context = buildHandoffContext({ ...result.handoff_input, channel: 'whatsapp', channel_conversation_reference: hash(payload.external_actor_id).slice(0, 32), adapter_metadata: { provider: 'meta_cloud_api' }, excluded_data_domains: ['NETROOM_PRIVATE'] }, result.handoff_decision, { handoff_id: result.handoff_id });
      try { handoff = await persist(context); } catch { return json(res, 503, { error: 'handoff_storage_unavailable' }); }
    }
    const response = {
      schema_version: 'OMEGA_CHANNEL_RESPONSE_V1', ok: true, deduplicated: false, channel: 'whatsapp',
      external_message_id: payload.external_message_id, correlation_id: payload.correlation_id,
      response: { type: result.response_type, text: result.text }, response_type: result.response_type,
      handoff_state: handoff ? 'requested' : 'none',
      events: result.events.map((item) => ({ event: item.name, timestamp: new Date().toISOString(), channel: 'whatsapp', schema_version: 'omega-events-v1', conversation_id: session.conversation_id, course_id: session.active_course || null, ...(item.detail === undefined ? {} : { detail: item.detail }) })),
      ...(handoff ? { handoff: { owner: 'OMEGA_GATE_05', handoff_id: result.handoff_id, status: handoff.status || 'WAITING_HUMAN' } } : {})
    };
    replay.set(`idempotency:${idempotencyKey}`, { digest, response });
    return json(res, 200, response);
  };
}

module.exports = { createIngressHandler, verifySignature, validatePayload, conversationId, MAX_SKEW_SECONDS };
