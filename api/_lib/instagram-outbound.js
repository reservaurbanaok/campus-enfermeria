'use strict';

const crypto = require('crypto');

const DEFAULT_GRAPH_BASE = 'https://graph.instagram.com';
const DEFAULT_GRAPH_VERSION = 'v25.0';
const EXPECTED_IG_USER_ID = '17841433759878333';
const MAX_TEXT_LENGTH = 1000;
const DEFAULT_TIMEOUT_MS = 10000;

function safeString(value, maxLength = 240) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/(access[_-]?token|app[_-]?secret|client[_-]?secret|authorization|code|state)\s*[=:]\s*[^\s,;}]+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function dispatchRef(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name) || null;
  return headers[name] || headers[name.toLowerCase()] || null;
}

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

function normalizeMetaError(data) {
  const error = data?.error && typeof data.error === 'object' ? data.error : data || {};
  return {
    meta_error_code: error.code == null ? null : String(error.code),
    meta_error_subcode: error.error_subcode == null ? null : String(error.error_subcode),
    meta_error_type: error.type == null ? null : safeString(error.type, 80),
    error_message: safeString(error.message || error.error_user_msg || 'instagram_send_failed'),
  };
}

function createInstagramOutboundSender(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => Date.now());
  const graphBase = String(options.graphBase || process.env.INSTAGRAM_LOGIN_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE).replace(/\/$/, '');
  const graphVersion = String(options.graphVersion || process.env.INSTAGRAM_LOGIN_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim();
  const expectedUserId = String(options.expectedUserId || process.env.INSTAGRAM_LOGIN_EXPECTED_IG_USER_ID || EXPECTED_IG_USER_ID).trim();
  const timeoutMs = Number(options.timeoutMs || process.env.INSTAGRAM_LOGIN_SEND_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const resolveAccessToken = options.resolveAccessToken || (() => {
    const oauthHandler = require('../omega/social/instagram-oauth');
    const session = oauthHandler.getActiveSession ? oauthHandler.getActiveSession(expectedUserId) : null;
    return session?.token || '';
  });

  return async function sendInstagramText(intent) {
    const correlationId = safeString(intent?.correlation_id, 120);
    const ref = dispatchRef(correlationId);
    const businessUserId = String(intent?.ig_business_user_id || '').trim();
    const recipientId = String(intent?.recipient_id || '').trim();
    const messageText = String(intent?.text || '').trim();
    console.log(JSON.stringify({ event: 'instagram_dispatch_entered', dispatch_ref: ref, channel_context: intent?.channel || null, response_text_present: Boolean(messageText), response_text_length: messageText.length, recipient_present: Boolean(recipientId) }));
    if (intent?.channel !== 'instagram' || intent?.provider !== 'meta_instagram' || intent?.operation !== 'send_text') { console.log(JSON.stringify({ event: 'instagram_dispatch_exit_reason', dispatch_ref: ref, reason: 'RESPONSE_SHAPE_MISMATCH' })); throw new Error('invalid_instagram_outbound_intent'); }
    if (businessUserId !== expectedUserId || !/^\d+$/.test(businessUserId)) { console.log(JSON.stringify({ event: 'instagram_dispatch_exit_reason', dispatch_ref: ref, reason: 'BUSINESS_ID_MISMATCH' })); throw new Error('unexpected_instagram_business_user_id'); }
    if (!/^\d+$/.test(recipientId) || recipientId === expectedUserId) { console.log(JSON.stringify({ event: 'instagram_dispatch_exit_reason', dispatch_ref: ref, reason: 'RECIPIENT_MISSING_OR_INVALID' })); throw new Error('invalid_instagram_recipient_id'); }
    if (!messageText || messageText.length > MAX_TEXT_LENGTH) { console.log(JSON.stringify({ event: 'instagram_dispatch_exit_reason', dispatch_ref: ref, reason: !messageText ? 'NO_TEXT' : 'TEXT_LENGTH_OVER_LIMIT' })); throw new Error('invalid_instagram_text'); }
    const token = String(await resolveAccessToken() || '').trim();
    console.log(JSON.stringify({ event: 'instagram_dispatch_credential_resolution', dispatch_ref: ref, credential_available: Boolean(token) }));
    if (!token) { console.log(JSON.stringify({ event: 'instagram_dispatch_exit_reason', dispatch_ref: ref, reason: 'CREDENTIAL_UNAVAILABLE' })); throw new Error('instagram_outbound_token_unavailable'); }
    console.log(JSON.stringify({ event: 'instagram_dispatch_sender_invoked', dispatch_ref: ref, sender_present: true }));

    const url = `${graphBase}/${graphVersion}/${encodeURIComponent(businessUserId)}/messages`;
    const startedAt = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text: messageText } }),
        signal: controller.signal,
      });
      const data = await readJson(response);
      const base = {
        http_status: response.status,
        meta_request_id: headerValue(response.headers, 'x-fb-request-id'),
        meta_trace_id: headerValue(response.headers, 'x-fb-trace-id'),
        correlation_id: correlationId,
        latency_ms: Math.max(0, now() - startedAt),
      };
      if (!response.ok) {
        const normalizedError = { success: false, ...base, ...normalizeMetaError(data) };
        const error = new Error('instagram_send_failed');
        error.outbound = normalizedError;
        throw error;
      }
      const result = {
        success: true,
        recipient_id: String(data?.recipient_id || recipientId),
        message_id: data?.message_id == null ? null : String(data.message_id),
        ...base,
      };
      console.log(JSON.stringify({ event: 'instagram_send_attempt', ...result }));
      console.log(JSON.stringify({ event: 'instagram_dispatch_exit_reason', dispatch_ref: ref, reason: 'META_SEND_ACCEPTED' }));
      return result;
    } catch (error) {
      if (error?.outbound) {
        console.error(JSON.stringify({ event: 'instagram_send_failed', ...error.outbound }));
        console.log(JSON.stringify({ event: 'instagram_dispatch_exit_reason', dispatch_ref: ref, reason: 'META_SEND_REJECTED' }));
        throw error;
      }
      const timedOut = error?.name === 'AbortError';
      const normalizedError = {
        success: false,
        http_status: null,
        meta_request_id: null,
        meta_trace_id: null,
        meta_error_code: null,
        meta_error_subcode: null,
        meta_error_type: timedOut ? 'timeout' : 'network',
        error_message: timedOut ? 'instagram_send_timeout' : 'instagram_send_network_error',
        correlation_id: correlationId,
        latency_ms: Math.max(0, now() - startedAt),
      };
      console.error(JSON.stringify({ event: 'instagram_send_failed', ...normalizedError }));
      console.log(JSON.stringify({ event: 'instagram_dispatch_exit_reason', dispatch_ref: ref, reason: timedOut ? 'META_SEND_TIMEOUT' : 'META_SEND_NETWORK_ERROR' }));
      const wrapped = new Error(timedOut ? 'instagram_send_timeout' : 'instagram_send_network_error');
      wrapped.outbound = normalizedError;
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = {
  createInstagramOutboundSender,
  DEFAULT_GRAPH_BASE,
  DEFAULT_GRAPH_VERSION,
  EXPECTED_IG_USER_ID,
};
