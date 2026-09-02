'use strict';

const crypto = require('crypto');
const net = require('net');
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
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;
const IP_RATE_LIMIT = 30;
const CONVERSATION_RATE_WINDOW_MS = 60 * 1000;
const CONVERSATION_RATE_LIMIT = 12;
const RESOLVER_TIMEOUT_MS = 15 * 1000;
const CONVERSATION_REF_PATTERN = /^omega_web_[a-f0-9-]{36}$/;

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
  return allowedOrigins().includes(origin);
}

function setCorsHeaders(req, res) {
  const origin = requestOrigin(req);
  if (!origin || !originAllowed(req)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
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

function validConversationRef(value) {
  return CONVERSATION_REF_PATTERN.test(String(value || ''));
}

function newConversationRef() {
  return `omega_web_${crypto.randomUUID()}`;
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
  if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > MAX_MESSAGE_LENGTH) return { ok: false, code: 'invalid_message' };
  if (payload.conversation_ref !== undefined && (typeof payload.conversation_ref !== 'string' || payload.conversation_ref.length > MAX_REFERENCE_LENGTH || !validConversationRef(payload.conversation_ref))) return { ok: false, code: 'invalid_conversation_ref' };
  return { ok: true };
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function trustedClientIp(req) {
  const edge = String(header(req, 'x-railway-edge') || '').trim();
  const realIp = String(header(req, 'x-real-ip') || '').trim();
  if (!edge || !realIp || net.isIP(realIp) === 0) return null;
  return realIp;
}

function rateLimitOk(rateStore, key, limit, windowMs, now) {
  const current = rateStore.get(key);
  if (!current || now - current.started_at >= windowMs) {
    rateStore.set(key, { started_at: now, count: 1 });
    return { ok: true };
  }
  if (current.count >= limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - current.started_at)) / 1000)) };
  current.count += 1;
  return { ok: true };
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('resolver_timeout'), { code: 'resolver_timeout' })), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function publicResponse(result, conversationRef, handoff) {
  return {
    response: { type: result.response_type, text: result.text },
    response_type: result.response_type,
    handoff_state: handoff ? 'requested' : 'none',
    conversation_ref: conversationRef,
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

    const conversationRef = payload.conversation_ref || newConversationRef();
    if (!validConversationRef(conversationRef)) return json(res, 400, { error: 'invalid_conversation_ref' });
    const clientIp = trustedClientIp(req);
    if (!clientIp) return json(res, 503, { error: 'client_ip_unavailable' });
    const currentTime = now();
    const ipLimit = rateLimitOk(rateStore, `ip:${clientIp}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS, currentTime);
    if (!ipLimit.ok) {
      res.setHeader('Retry-After', String(ipLimit.retryAfter));
      return json(res, 429, { error: 'rate_limited' });
    }
    const conversationLimit = rateLimitOk(rateStore, `conversation:${hash(conversationRef)}`, CONVERSATION_RATE_LIMIT, CONVERSATION_RATE_WINDOW_MS, currentTime);
    if (!conversationLimit.ok) {
      res.setHeader('Retry-After', String(conversationLimit.retryAfter));
      return json(res, 429, { error: 'rate_limited' });
    }

    const correlationId = `web:${crypto.randomUUID()}`;
    const conversationIdentity = `ref:${conversationRef}`;
    const conversationId = `web-${hash(conversationIdentity).slice(0, 32)}`;
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
        external_sender_id: conversationIdentity,
        channel_conversation_reference: hash(conversationIdentity).slice(0, 32),
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
      person_or_anonymous_id: `web:${hash(conversationRef)}`,
      source: 'omega_web_adapter',
    });

    let handoff = null;
    if (result.handoff_input) {
      const context = buildHandoffContext({
        ...result.handoff_input,
        channel: 'campus_web',
        channel_conversation_reference: hash(conversationIdentity).slice(0, 32),
        adapter_metadata: { provider: 'campus_web', surface: 'omega_concierge' },
        excluded_data_domains: ['NETROOM_PRIVATE'],
      }, result.handoff_decision, { handoff_id: result.handoff_id });
      try { handoff = await persistHandoff(context); } catch { return json(res, 503, { error: 'handoff_storage_unavailable' }); }
    }

    return json(res, 200, publicResponse(result, conversationRef, handoff));
  };
}

module.exports = { COOKIE_NAME, MAX_BODY_BYTES, MAX_MESSAGE_LENGTH, createWebChatHandler, validatePayload, validSessionId };
