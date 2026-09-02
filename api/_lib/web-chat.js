'use strict';

const crypto = require('crypto');
const { buildHandoffContext } = require('../../handoff/omega-handoff-context');
const { createHandoff } = require('../../handoff/omega-handoff-persistence');
const { createSession } = require('../../core/omega-concierge-core');
const { resolveConversationalResponse } = require('../../core/omega-conversational-resolver');
const { createConfiguredModelProvider } = require('../../core/omega-model-provider');
const { defaultOfficialSourceRetriever } = require('../../core/omega-official-source');
const { defaultRuntimeConversationStateStore } = require('./omega-conversation-state-store');
const { captureCanonicalEvents } = require('./commercial-event-store');

const COOKIE_NAME = 'omega_web_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_REFERENCE_LENGTH = 160;
const MAX_RATE_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const RESOLVER_TIMEOUT_MS = 15 * 1000;
const PRIVILEGED_FIELDS = new Set(['verified_identity', 'privileged_context', 'permissions', 'user_id', 'identity', 'auth']);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function header(req, name) {
  const value = req?.headers?.[name.toLowerCase()] ?? req?.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function requestOrigin(req) {
  const origin = String(header(req, 'origin') || '').trim();
  return origin || null;
}

function requestBaseOrigin(req) {
  const host = String(header(req, 'host') || '').trim();
  if (!host) return null;
  const forwardedProto = String(header(req, 'x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || (req?.socket?.encrypted ? 'https' : 'http');
  return `${protocol}://${host}`;
}

function allowedOrigins() {
  return String(process.env.OMEGA_WEB_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function originAllowed(req) {
  const origin = requestOrigin(req);
  if (!origin) return true;
  const configured = allowedOrigins();
  if (configured.includes(origin)) return true;
  return requestBaseOrigin(req) === origin;
}

function setCorsHeaders(req, res) {
  const origin = requestOrigin(req);
  if (!origin || !originAllowed(req)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
}

function readCookies(req) {
  const cookies = {};
  for (const part of String(header(req, 'cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function validSessionId(value) {
  return /^web_[a-f0-9-]{36}$/.test(String(value || ''));
}

function sessionCookie(sessionId, req) {
  const secure = String(header(req, 'x-forwarded-proto') || '').split(',')[0].trim() === 'https' || req?.socket?.encrypted;
  return `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${SESSION_MAX_AGE}`;
}

function getOrCreateSessionId(req, res, idFactory = () => `web_${crypto.randomUUID()}`) {
  const existing = readCookies(req)[COOKIE_NAME];
  if (validSessionId(existing)) return { sessionId: existing, created: false };
  const sessionId = idFactory();
  if (!validSessionId(sessionId)) throw new Error('invalid_session_id');
  res.setHeader('Set-Cookie', sessionCookie(sessionId, req));
  return { sessionId, created: true };
}

async function readRawBody(req) {
  if (req?.body !== undefined) {
    const value = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    if (value.length > MAX_BODY_BYTES) throw Object.assign(new Error('body_too_large'), { code: 'body_too_large' });
    return value;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('body_too_large'), { code: 'body_too_large' });
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, code: 'invalid_json' };
  for (const field of PRIVILEGED_FIELDS) if (Object.hasOwn(payload, field)) return { ok: false, code: 'privileged_context_not_allowed' };
  if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > MAX_MESSAGE_LENGTH) return { ok: false, code: 'invalid_message' };
  if (payload.conversation_ref !== undefined && (typeof payload.conversation_ref !== 'string' || payload.conversation_ref.length > MAX_REFERENCE_LENGTH)) return { ok: false, code: 'invalid_conversation_ref' };
  if (payload.page_url !== undefined && (typeof payload.page_url !== 'string' || payload.page_url.length > 2048)) return { ok: false, code: 'invalid_page_url' };
  return { ok: true };
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function rateLimitOk(rateStore, sessionId, now) {
  const current = rateStore.get(sessionId);
  if (!current || now - current.started_at >= MAX_RATE_WINDOW_MS) {
    rateStore.set(sessionId, { started_at: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_REQUESTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('resolver_timeout'), { code: 'resolver_timeout' })), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function publicResponse(result, correlationId, sessionId, handoff, trace = {}) {
  return {
    schema_version: 'OMEGA_WEB_CHAT_RESPONSE_V1',
    ok: true,
    channel: 'web',
    correlation_id: correlationId,
    conversation_id: result.state_key ? `web-${hash(sessionId).slice(0, 32)}` : null,
    response: { type: result.response_type, text: result.text },
    response_type: result.response_type,
    handoff_state: handoff ? 'requested' : 'none',
    events: (result.events || []).map((item) => ({ event: item.name, schema_version: 'omega-events-v1' })),
    grounding: { status: result.grounding_status, source_used: result.source_used === true, source_url: result.source_url || null },
    runtime: {
      response_mode: result.response_mode,
      selected_skill: result.selected_skill,
      skill_executed: result.skill_executed,
      conversation_history_used: result.conversation_history_used === true,
      web_runtime_trace: {
        resolver_called: trace.resolver_called === true,
        model_provider_called: trace.model_provider_called === true,
        source_retriever_called: trace.source_retriever_called === true,
        state_store_used: trace.state_store_used === true,
        admissions_reached: result.selected_skill === 'OMEGA_ADMISSIONS',
      },
    },
    ...(handoff ? { handoff: { owner: 'OMEGA_GATE_05', handoff_id: result.handoff_id, status: handoff.status || 'WAITING_HUMAN' } } : {}),
  };
}

function createWebChatHandler(options = {}) {
  const rateStore = options.rateStore || new Map();
  const now = options.now || (() => Date.now());
  const resolve = options.resolveConversationalResponse || resolveConversationalResponse;
  const stateStore = options.stateStore || defaultRuntimeConversationStateStore;
  const persistHandoff = options.persistHandoff || (async (context) => {
    const { getDatabase } = require('./db');
    return createHandoff(getDatabase(), context);
  });
  const captureEvents = options.captureEvents || captureCanonicalEvents;
  const idFactory = options.idFactory || (() => `web_${crypto.randomUUID()}`);

  return async function webChat(req, res) {
    setCorsHeaders(req, res);
    if (!originAllowed(req)) return json(res, 403, { error: 'origin_not_allowed' });
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      res.statusCode = 204;
      return res.end();
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    if (header(req, 'content-type') && !String(header(req, 'content-type')).toLowerCase().startsWith('application/json')) return json(res, 415, { error: 'json_required' });

    let rawBody;
    try { rawBody = await readRawBody(req); } catch (error) { return json(res, error.code === 'body_too_large' ? 413 : 400, { error: error.code || 'invalid_body' }); }
    let payload;
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch { return json(res, 400, { error: 'invalid_json' }); }
    const validation = validatePayload(payload);
    if (!validation.ok) return json(res, 400, { error: validation.code });

    let session;
    try { session = getOrCreateSessionId(req, res, idFactory); } catch { return json(res, 500, { error: 'session_unavailable' }); }
    if (!rateLimitOk(rateStore, session.sessionId, now())) {
      res.setHeader('Retry-After', '60');
      return json(res, 429, { error: 'rate_limited' });
    }

    const correlationId = `web:${crypto.randomUUID()}`;
    const conversationId = `web-${hash(session.sessionId).slice(0, 32)}`;
    const runtimeSession = createSession({ conversation_id: conversationId, started: true });
    const trace = { resolver_called: false, model_provider_called: false, source_retriever_called: false, state_store_used: false };
    const tracedStateStore = {
      async load(key) {
        trace.state_store_used = true;
        return stateStore.load(key);
      },
      async save(key, value) {
        trace.state_store_used = true;
        return stateStore.save(key, value);
      },
    };
    const sourceRetriever = options.sourceRetriever || defaultOfficialSourceRetriever;
    const tracedSourceRetriever = async (request) => {
      trace.source_retriever_called = true;
      return sourceRetriever(request);
    };
    const configuredProvider = options.modelProvider === undefined ? createConfiguredModelProvider() : options.modelProvider;
    const tracedModelProvider = configuredProvider && typeof configuredProvider.generate === 'function' ? {
      ...configuredProvider,
      async generate(args) {
        trace.model_provider_called = true;
        return configuredProvider.generate(args);
      },
    } : configuredProvider;
    let result;
    try {
      trace.resolver_called = true;
      result = await withTimeout(resolve(runtimeSession, payload.message.trim(), {
        channel: 'web',
        external_sender_id: session.sessionId,
        channel_conversation_reference: payload.conversation_ref ? hash(payload.conversation_ref).slice(0, 32) : hash(session.sessionId).slice(0, 32),
        adapter_metadata: { provider: 'campus_web', surface: 'omega_concierge' },
        handoff_id: `handoff-${correlationId}`,
        stateStore: tracedStateStore,
        sourceRetriever: tracedSourceRetriever,
        modelProvider: tracedModelProvider,
      }), RESOLVER_TIMEOUT_MS);
    } catch (error) {
      return json(res, error.code === 'resolver_timeout' ? 504 : 502, { error: error.code === 'resolver_timeout' ? 'resolver_timeout' : 'runtime_unavailable' });
    }

    captureEvents(result.events, {
      channel: 'campus_web',
      conversation_id: conversationId,
      correlation_id: correlationId,
      person_or_anonymous_id: `web:${hash(session.sessionId)}`,
      source: 'omega_web_adapter',
    });

    let handoff = null;
    if (result.handoff_input) {
      const context = buildHandoffContext({
        ...result.handoff_input,
        channel: 'campus_web',
        channel_conversation_reference: hash(session.sessionId).slice(0, 32),
        adapter_metadata: { provider: 'campus_web', surface: 'omega_concierge' },
        excluded_data_domains: ['NETROOM_PRIVATE'],
      }, result.handoff_decision, { handoff_id: result.handoff_id });
      try { handoff = await persistHandoff(context); } catch { return json(res, 503, { error: 'handoff_storage_unavailable' }); }
    }

    return json(res, 200, publicResponse(result, correlationId, session.sessionId, handoff, trace));
  };
}

module.exports = { COOKIE_NAME, MAX_BODY_BYTES, MAX_MESSAGE_LENGTH, createWebChatHandler, validatePayload, validSessionId };
