'use strict';

const crypto = require('crypto');
const { createSession } = require('../../core/omega-concierge-core');
const { resolveConversationalResponse } = require('../../core/omega-conversational-resolver');
const { defaultRuntimeConversationStateStore } = require('./omega-conversation-state-store');
const { buildHandoffContext } = require('../../handoff/omega-handoff-context');
const { captureCanonicalEvents } = require('./commercial-event-store');

const CHANNEL = 'instagram';
const EXPECTED_INSTAGRAM_USER_ID = '17841433759878333';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TEXT_LENGTH = 500;
const MAX_SKEW_SECONDS = 300;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function text(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}

function header(req, name) {
  const headers = req.headers || {};
  return String(headers[name.toLowerCase()] || headers[name] || '');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readRawBody(req) {
  if (req.body !== undefined && req.body !== null) {
    const body = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
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

function verifyMetaSignature(body, supplied, secret) {
  const value = String(supplied || '').replace(/^sha256=/, '').toLowerCase();
  if (!secret || !/^[a-f0-9]{64}$/.test(value)) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return timingSafeEqualText(expected, value);
}

function configuredMetaSecrets() {
  return [...new Set([
    process.env.INSTAGRAM_META_APP_SECRET,
    process.env.INSTAGRAM_LOGIN_APP_SECRET,
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function verifyChallenge(url) {
  const expected = String(process.env.INSTAGRAM_META_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || '').trim();
  const mode = url.searchParams.get('hub.mode') || '';
  const supplied = url.searchParams.get('hub.verify_token') || '';
  const challenge = url.searchParams.get('hub.challenge') || '';
  if (mode !== 'subscribe' || !expected || !challenge || !timingSafeEqualText(supplied, expected)) return false;
  return challenge;
}

function isoTimestamp(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('missing_timestamp');
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('invalid_timestamp');
  const milliseconds = numeric > 100000000000 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_timestamp');
  return date.toISOString();
}

function requiredId(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing_${field}`);
  return value.trim();
}

function normalizePayload(payload, expectedUserId = EXPECTED_INSTAGRAM_USER_ID) {
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry) || payload.entry.length === 0) throw new Error('malformed_meta_payload');
  const events = [];
  for (const entry of payload.entry) {
    if (!entry || typeof entry !== 'object') throw new Error('malformed_meta_payload');
    const instagramUserId = requiredId(String(entry.id || ''), 'instagram_user_id');
    if (expectedUserId && instagramUserId !== expectedUserId) throw new Error('wrong_instagram_user_id');
    if (!Array.isArray(entry.messaging) || entry.messaging.length === 0) throw new Error('missing_messaging_event');
    for (const messaging of entry.messaging) {
      if (!messaging || typeof messaging !== 'object') throw new Error('malformed_messaging_event');
      const sender = messaging.sender;
      const recipient = messaging.recipient;
      if (!sender || !recipient) throw new Error('missing_identity');
      const senderId = requiredId(String(sender.id || ''), 'sender_id');
      const recipientId = requiredId(String(recipient.id || ''), 'recipient_id');
      if (recipientId !== instagramUserId) throw new Error('identity_mismatch');
      const occurredAt = isoTimestamp(messaging.timestamp);
      const message = messaging.message;
      if (!message || typeof message !== 'object') {
        events.push({ event_kind: 'unsupported', reason: 'non_message_event', instagram_user_id: instagramUserId, sender_id: senderId });
        continue;
      }
      if (message.is_echo === true) {
        events.push({ event_kind: 'unsupported', reason: 'echo', instagram_user_id: instagramUserId, sender_id: senderId, external_message_id: message.mid || null });
        continue;
      }
      const messageId = requiredId(String(message.mid || ''), 'message_id');
      if (typeof message.text !== 'string' || !message.text.trim()) {
        events.push({ event_kind: 'unsupported', reason: 'unsupported_message_type', instagram_user_id: instagramUserId, sender_id: senderId, external_message_id: messageId });
        continue;
      }
      const messageText = message.text.trim();
      if (messageText.length > MAX_TEXT_LENGTH) throw new Error('message_too_long');
      const correlationId = `ig:${instagramUserId}:${messageId}:${hash(`${instagramUserId}:${messageId}`).slice(0, 12)}`;
      const normalized = {
        schema_version: 'OMEGA_CHANNEL_MESSAGE_V1',
        channel: CHANNEL,
        external_message_id: messageId,
        conversation: { channel: CHANNEL, external_id: `${instagramUserId}:${senderId}` },
        sender: { external_id: senderId },
        message: { type: 'text', text: messageText },
        occurred_at: occurredAt,
        consent_status: 'unknown',
        correlation_id: correlationId
      };
      if (message.reply_to && typeof message.reply_to.mid === 'string' && message.reply_to.mid.trim()) normalized.reply_context_ref = message.reply_to.mid.trim();
      events.push({
        event_kind: 'message',
        instagram_user_id: instagramUserId,
        sender_id: senderId,
        normalized
      });
    }
  }
  return events.length ? events : (() => { throw new Error('missing_messaging_event'); })();
}

function canonicalResponse(message, result, handoff) {
  const response = {
    schema_version: 'OMEGA_CHANNEL_RESPONSE_V1',
    ok: true,
    channel: CHANNEL,
    external_message_id: message.external_message_id,
    correlation_id: message.correlation_id,
    response_type: result.response_type,
    text: result.text,
    destination: { channel: CHANNEL, external_id: message.sender.external_id },
    actions: result.action ? [result.action] : [],
    handoff_state: handoff ? 'requested' : 'none',
    events: (result.events || []).map((item) => ({
      event: item.name,
      channel: CHANNEL,
      schema_version: 'omega-events-v1'
    })),
    audit: { event_ref: handoff ? handoff.handoff_id : `core:${message.correlation_id}` }
  };
  if (handoff) response.handoff = handoff;
  return response;
}

function outboundIntent(response, instagramUserId) {
  if (response.response_type === 'no_reply') return null;
  if (!['text', 'handoff'].includes(response.response_type) || typeof response.text !== 'string' || !response.text.trim()) throw new Error('invalid_response_contract');
  const intent = {
    provider: 'meta_instagram',
    channel: CHANNEL,
    operation: 'send_text',
    ig_business_user_id: instagramUserId,
    recipient_id: response.destination.external_id,
    text: response.text,
    correlation_id: response.correlation_id,
    source_response_type: response.response_type,
    handoff_state: response.handoff_state
  };
  if (response.handoff) intent.handoff = response.handoff;
  return intent;
}

function trace(message, response, duplicate = false) {
  return {
    external_message_id: message.external_message_id,
    correlation_id: message.correlation_id,
    normalized_contract: 'OMEGA_CHANNEL_MESSAGE_V1',
    normalized_channel: message.channel,
    normalized_message_hash: hash(JSON.stringify(message)),
    normalized_sender_ref: hash(message.sender.external_id).slice(0, 16),
    core_execution: 'resolveConversationalResponse',
    response_contract: response.schema_version,
    outbound_intent: response.response_type === 'no_reply' ? 'none' : 'created',
    duplicate_ignored: duplicate
  };
}

function defaultPersistHandoff() {
  const { getDatabase } = require('./db');
  const { createHandoff } = require('../../handoff/omega-handoff-persistence');
  return (context) => createHandoff(getDatabase(), context);
}

function defaultFindActiveHandoff(conversationId) {
  const { getDatabase } = require('./db');
  return getDatabase().query(
    "SELECT handoff_id,status FROM public.omega_handoffs WHERE conversation_id = $1 AND status IN ('WAITING_HUMAN','HUMAN_ACTIVE') ORDER BY created_at DESC LIMIT 1",
    [conversationId],
  ).then((result) => result.rows[0] || null);
}

function createInstagramIngressHandler(options = {}) {
  const replay = options.replayStore || new Map();
  const sendOutbound = options.sendOutbound || null;
  const persistHandoff = options.persistHandoff || defaultPersistHandoff();
  const findActiveHandoff = options.findActiveHandoff || defaultFindActiveHandoff;
  const now = options.now || (() => Math.floor(Date.now() / 1000));
  return async function instagramIngress(req, res, requestUrl) {
    if (req.method === 'GET') {
      const challenge = verifyChallenge(requestUrl);
      return challenge === false ? json(res, 403, { error: 'invalid_meta_verification' }) : text(res, 200, challenge);
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    let body;
    try { body = await readRawBody(req); } catch (error) { return json(res, error.code === 'body_too_large' ? 413 : 400, { error: error.code || 'invalid_body' }); }
    const suppliedSignature = header(req, 'x-hub-signature-256');
    const secrets = configuredMetaSecrets();
    if (!secrets.some((secret) => verifyMetaSignature(body, suppliedSignature, secret))) {
      console.warn(JSON.stringify({
        event: 'instagram_webhook_rejected',
        reason: 'invalid_signature',
        signature_scheme: suppliedSignature.startsWith('sha256=') ? 'sha256' : 'unknown',
        configured_secret_count: secrets.length,
      }));
      return json(res, 401, { error: 'invalid_signature' });
    }
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch { return json(res, 400, { error: 'malformed_meta_payload' }); }
    let events;
    try { events = normalizePayload(payload); } catch (error) { return json(res, 400, { error: error.message || 'malformed_meta_payload' }); }
    console.log(JSON.stringify({
      event: 'instagram_webhook_received',
      event_count: events.length,
      message_event_count: events.filter((item) => item.event_kind === 'message').length,
      unsupported_event_count: events.filter((item) => item.event_kind === 'unsupported').length,
    }));
    const output = [];
    for (const event of events) {
      if (event.event_kind === 'unsupported') {
        output.push({ accepted: true, classified: 'unsupported', reason: event.reason, core_routed: false, outbound_intent: null, trace: { external_message_id: event.external_message_id || null, correlation_id: null, normalized_contract: null, core_execution: 'not_called', response_contract: null, outbound_intent: 'none', duplicate_ignored: false } });
        continue;
      }
      const message = event.normalized;
      const key = `${CHANNEL}:${message.external_message_id}`;
      const digest = hash(JSON.stringify(message));
      const existing = replay.get(key);
      if (existing) {
        if (existing.digest !== digest) return json(res, 409, { error: 'idempotency_conflict', correlation_id: message.correlation_id });
        output.push({ ...existing.output, deduplicated: true, trace: trace(message, existing.response, true) });
        continue;
      }
      const session = createSession({ conversation_id: `instagram-${hash(message.sender.external_id).slice(0, 32)}`, started: true });
      const coreResult = await resolveConversationalResponse(session, message.message.text, {
        channel: CHANNEL,
        external_sender_id: message.sender.external_id,
        channel_conversation_reference: hash(message.conversation.external_id).slice(0, 32),
        adapter_metadata: { provider: 'meta_instagram', instagram_user_id: event.instagram_user_id },
        handoff_id: `handoff-${message.external_message_id}`,
        stateStore: options.stateStore || defaultRuntimeConversationStateStore,
        sourceRetriever: options.sourceRetriever,
        modelProvider: options.modelProvider,
      });
      captureCanonicalEvents(coreResult.events, {
        channel: CHANNEL,
        conversation_id: session.conversation_id,
        correlation_id: message.correlation_id,
        person_or_anonymous_id: `sha256:${hash(message.sender.external_id)}`,
        source: 'omega_instagram_social_ingress',
      });
      let handoff = null;
      if (coreResult.handoff_input) {
        const context = buildHandoffContext({
          ...coreResult.handoff_input,
          channel: CHANNEL,
          channel_conversation_reference: hash(message.conversation.external_id).slice(0, 32),
          adapter_metadata: { provider: 'meta_instagram', instagram_user_id: event.instagram_user_id },
          excluded_data_domains: ['NETROOM_PRIVATE']
        }, coreResult.handoff_decision, { handoff_id: coreResult.handoff_id });
        try {
          handoff = await findActiveHandoff(context.conversation_id);
          if (!handoff) handoff = await persistHandoff(context);
        } catch (error) {
          console.error(JSON.stringify({ event: 'instagram_handoff_storage_failed', code: error && error.code ? String(error.code) : 'unknown' }));
          return json(res, 503, { error: 'handoff_storage_unavailable', correlation_id: message.correlation_id });
        }
        handoff = { owner: 'OMEGA_GATE_05', handoff_id: coreResult.handoff_id, status: handoff.status || 'WAITING_HUMAN' };
      }
      const response = canonicalResponse(message, coreResult, handoff);
      const intent = outboundIntent(response, event.instagram_user_id);
      const dispatchRef = hash(message.correlation_id).slice(0, 16);
      console.log(JSON.stringify({
        event: 'instagram_dispatch_entered',
        dispatch_ref: dispatchRef,
        response_type: response.response_type || null,
        response_text_present: typeof response.text === 'string' && Boolean(response.text.trim()),
        response_text_length: typeof response.text === 'string' ? response.text.length : 0,
        recipient_present: Boolean(response.destination?.external_id),
        channel_context: response.channel || null,
        handoff_state: response.handoff_state || 'none',
      }));
      console.log(JSON.stringify({
        event: 'instagram_dispatch_should_send',
        dispatch_ref: dispatchRef,
        should_send: Boolean(intent),
        decision: intent ? 'SEND' : 'NO_REPLY',
      }));
      console.log(JSON.stringify({
        event: 'instagram_pipeline_pass',
        correlation_ref: dispatchRef,
        sender_ref: hash(message.sender.external_id).slice(0, 16),
        instagram_user_id: event.instagram_user_id,
        meta_webhook_received: true,
        instagram_event_matched: true,
        real_sender_id_captured: true,
        normalization_pass: true,
        channel_routing_pass: true,
        omega_channel_message_v1_pass: true,
        campus_core_pass: true,
        canonical_core_pass: true,
        skill_routing_pass: true,
        omega_channel_response_v1_pass: true,
        outbound_intent_created: Boolean(intent),
      }));
      const item = { accepted: true, classified: 'message', core_routed: true, response, outbound_intent: intent, outbound_result: null, deduplicated: false, trace: trace(message, response) };
      replay.set(key, { digest, response, output: item });
      if (intent && sendOutbound) {
        console.log(JSON.stringify({ event: 'instagram_dispatch_sender_invoked', dispatch_ref: dispatchRef, sender_present: true }));
        try {
          item.outbound_result = await sendOutbound(intent);
          console.log(JSON.stringify({ event: 'instagram_dispatch_exit_reason', dispatch_ref: dispatchRef, reason: item.outbound_result?.success === true ? 'SENDER_SUCCESS' : 'SENDER_RESULT_FAILURE' }));
        } catch (error) {
          item.outbound_result = error?.outbound || {
            success: false,
            error_code: 'instagram_outbound_failed',
            correlation_id: message.correlation_id,
          };
          console.log(JSON.stringify({ event: 'instagram_dispatch_exit_reason', dispatch_ref: dispatchRef, reason: item.outbound_result.error_code || error?.message || 'SENDER_ERROR' }));
        }
      } else {
        console.log(JSON.stringify({ event: 'instagram_dispatch_exit_reason', dispatch_ref: dispatchRef, reason: intent ? 'SENDER_NOT_CONFIGURED' : 'SHOULD_RESPOND_FALSE' }));
      }
      output.push(item);
    }
    return json(res, 200, { ok: true, route: 'instagram-social', events: output, received_at: new Date(now() * 1000).toISOString() });
  };
}

module.exports = { createInstagramIngressHandler, normalizePayload, verifyMetaSignature, MAX_SKEW_SECONDS };
