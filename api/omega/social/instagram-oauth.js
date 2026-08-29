'use strict';

const crypto = require('crypto');

const DEFAULT_GRAPH_VERSION = 'v25.0';
const DEFAULT_IG_USER_ID = '17841433759878333';
const DEFAULT_IG_USERNAME = 'campus.enfermeria';
const INSTAGRAM_APP_ID = '4296194637360399';
const INSTAGRAM_PARENT_APP_ID = '4382588185329556';
const REQUIRED_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages'];
const START_PATH = '/oauth/gate08/instagram';
const CALLBACK_PATH = '/oauth/gate08/instagram/callback';
const STATUS_PATH = '/oauth/gate08/instagram/status';
const SESSION_COOKIE = 'omega_gate08_ig_oauth_session';
const STATE_TABLE = 'omega_gate08_instagram_oauth_states';
const CREDENTIAL_TABLE = 'omega_gate08_instagram_credentials';
const STATE_MAX_AGE = 600;
const CREDENTIAL_REFRESH_WINDOW = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
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

function cookieValue(req, name) {
  const cookies = header(req, 'cookie').split(';');
  const prefix = `${name}=`;
  const value = cookies.find((item) => item.trim().startsWith(prefix));
  return value ? decodeURIComponent(value.trim().slice(prefix.length)) : '';
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('base64url');
}

function credentialKey() {
  const secret = String(process.env.INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!secret) return null;
  return crypto.createHash('sha256').update('omega-gate08-instagram-credential-v1').update(secret).digest();
}

function encryptCredential(token, randomBytes) {
  const key = credentialKey();
  if (!key) throw new Error('credential_encryption_unavailable');
  const iv = Buffer.from(randomBytes(12)).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  };
}

function decryptCredential(record) {
  const key = credentialKey();
  if (!key || !record?.token_ciphertext || !record?.token_iv || !record?.token_auth_tag) throw new Error('credential_decryption_unavailable');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.token_iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(record.token_auth_tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.token_ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function signedValue(value, secret) {
  return `${value}.${hmac(value, secret)}`;
}

function verifySignedValue(value, secret) {
  const [plain, signature] = String(value || '').split('.');
  if (!plain || !signature || !secret) return '';
  return timingSafeEqualText(signature, hmac(plain, secret)) ? plain : '';
}

function pruneOAuthStates(stateStore, currentTime) {
  for (const [state, record] of stateStore.entries()) {
    const createdAt = Date.parse(record?.created_at || '');
    if (record?.used === true || !Number.isFinite(createdAt) || currentTime - createdAt > STATE_MAX_AGE * 1000) stateStore.delete(state);
  }
}

function consumeOAuthState(stateStore, state, currentTime) {
  if (!state) return false;
  pruneOAuthStates(stateStore, currentTime);
  const record = stateStore.get(state);
  if (!record || record.used === true) return false;
  const createdAt = Date.parse(record.created_at);
  if (!Number.isFinite(createdAt) || currentTime - createdAt > STATE_MAX_AGE * 1000) {
    stateStore.delete(state);
    return false;
  }
  record.used = true;
  record.used_at = new Date(currentTime).toISOString();
  stateStore.set(state, record);
  return true;
}

async function ensureOAuthStateTable(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
      state TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      used_at TIMESTAMPTZ,
      correlation_reference TEXT NOT NULL
    )
  `);
}

async function ensureCredentialTable(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS ${CREDENTIAL_TABLE} (
      instagram_user_id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      parent_app_id TEXT NOT NULL,
      username TEXT NOT NULL,
      token_ciphertext TEXT NOT NULL,
      token_iv TEXT NOT NULL,
      token_auth_tag TEXT NOT NULL,
      scopes TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ
    )
  `);
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/oauth/gate08/instagram', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  const cookies = res.__omegaGate08SetCookies || [];
  cookies.push(parts.join('; '));
  res.__omegaGate08SetCookies = cookies;
  res.setHeader('Set-Cookie', cookies);
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

function config() {
  const appSecret = String(process.env.INSTAGRAM_LOGIN_APP_SECRET || '').trim();
  return {
    appId: String(process.env.INSTAGRAM_LOGIN_APP_ID || INSTAGRAM_APP_ID).trim(),
    parentAppId: String(process.env.INSTAGRAM_META_PARENT_APP_ID || INSTAGRAM_PARENT_APP_ID).trim(),
    appSecret,
    stateSecret: String(process.env.INSTAGRAM_LOGIN_STATE_SECRET || process.env.OMEGA_CHANNEL_INGRESS_SECRET || appSecret).trim(),
    redirectUri: String(process.env.INSTAGRAM_LOGIN_REDIRECT_URI || '').trim(),
    graphBase: String(process.env.INSTAGRAM_LOGIN_GRAPH_BASE_URL || 'https://graph.instagram.com').replace(/\/$/, ''),
    graphVersion: String(process.env.INSTAGRAM_LOGIN_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim(),
    expectedUserId: String(process.env.INSTAGRAM_LOGIN_EXPECTED_IG_USER_ID || DEFAULT_IG_USER_ID).trim(),
    expectedUsername: String(process.env.INSTAGRAM_LOGIN_EXPECTED_IG_USERNAME || DEFAULT_IG_USERNAME).trim(),
  };
}

function logEvent(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

function safeSubscription(data, appId, parentAppId) {
  const entries = Array.isArray(data?.data) ? data.data : [];
  const appIdOf = (entry) => String(entry?.application?.id || entry?.application?.app_id || entry?.id || entry?.app_id || '');
  const knownAppIds = new Set([appId, parentAppId].filter(Boolean));
  const matching = entries.find((entry) => knownAppIds.has(appIdOf(entry)));
  const scopedEntry = !matching && entries.length === 1 ? entries[0] : null;
  const effectiveEntry = matching || scopedEntry;
  const fields = Array.isArray(effectiveEntry?.subscribed_fields) ? effectiveEntry.subscribed_fields.filter((field) => typeof field === 'string') : [];
  return {
    query: 'PASS',
    current_subscribed_app: matching ? appIdOf(matching) : (scopedEntry ? appId : (entries[0] ? appIdOf(entries[0]) || null : null)),
    current_subscribed_fields: fields,
    messages_account_subscribed: fields.includes('messages'),
    entry_count: entries.length,
  };
}

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

async function exchangeCode(code, cfg, fetchImpl) {
  const body = new URLSearchParams({
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: cfg.redirectUri,
    code,
  });
  const response = await fetchImpl('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await readJson(response);
  if (!response.ok || !data?.access_token) throw new Error('token_exchange_failed');
  return data;
}

async function readProfile(token, cfg, fetchImpl) {
  const url = new URL(`${cfg.graphBase}/${cfg.graphVersion}/me`);
  url.searchParams.set('fields', 'id,user_id,username,account_type');
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await readJson(response);
  if (!response.ok || !data) throw new Error('profile_validation_failed');
  const userId = String(data.user_id || data.id || '').trim();
  if (userId !== cfg.expectedUserId || String(data.username || '').trim() !== cfg.expectedUsername) throw new Error('unexpected_instagram_account');
  return { userId, username: String(data.username), accountType: data.account_type || null };
}

async function readSubscription(token, cfg, fetchImpl) {
  const url = `${cfg.graphBase}/${cfg.graphVersion}/${encodeURIComponent(cfg.expectedUserId)}/subscribed_apps`;
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await readJson(response);
  if (!response.ok || !data) throw new Error('subscription_query_failed');
  return safeSubscription(data, cfg.appId, cfg.parentAppId);
}

async function readSubscriptionUntilMessages(token, cfg, fetchImpl) {
  const retryDelays = [0, 500, 1000, 2000];
  let subscription;
  for (const delay of retryDelays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    subscription = await readSubscription(token, cfg, fetchImpl);
    if (subscription.messages_account_subscribed) return subscription;
  }
  return subscription;
}

async function refreshAccessToken(token, cfg, fetchImpl) {
  const url = new URL(`${cfg.graphBase}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);
  const response = await fetchImpl(url, { method: 'GET' });
  const data = await readJson(response);
  if (!response.ok || !data?.access_token) throw new Error('credential_refresh_failed');
  return data;
}

async function subscribeMessages(token, cfg, fetchImpl) {
  const url = new URL(`${cfg.graphBase}/${cfg.graphVersion}/${encodeURIComponent(cfg.expectedUserId)}/subscribed_apps`);
  url.searchParams.set('subscribed_fields', 'messages');
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscribed_fields: ['messages'] }),
  });
  const data = await readJson(response);
  if (!response.ok || data?.success !== true) throw new Error('subscription_update_failed');
  return true;
}

function createInstagramOAuthHandler(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const randomBytes = options.randomBytes || ((size) => crypto.randomBytes(size));
  const now = options.now || (() => Date.now());
  const sessions = options.sessions || new Map();
  const stateStore = options.stateStore || null;
  const credentialStore = options.credentialStore || null;
  let databasePromise;
  let stateTablePromise;
  let credentialTablePromise;

  function getDatabase() {
    if (options.database) return Promise.resolve(options.database);
    if (!databasePromise) databasePromise = Promise.resolve().then(() => require('../../_lib/db').getDatabase());
    return databasePromise;
  }

  async function prepareStateStorage() {
    if (stateStore) return true;
    if (!stateTablePromise) {
      stateTablePromise = getDatabase().then(async (database) => {
        await ensureOAuthStateTable(database);
        return database;
      });
    }
    try { await stateTablePromise; return true; } catch { return false; }
  }

  async function prepareCredentialStorage() {
    if (credentialStore) return true;
    if (!credentialTablePromise) {
      credentialTablePromise = getDatabase().then(async (database) => {
        await ensureCredentialTable(database);
        return database;
      });
    }
    try { await credentialTablePromise; return true; } catch { return false; }
  }

  async function saveCredential(profile, token, scopes, expiresIn, currentTime) {
    const encrypted = encryptCredential(token, randomBytes);
    const expiresAt = Number.isFinite(Number(expiresIn)) && Number(expiresIn) > 0
      ? new Date(currentTime + Number(expiresIn) * 1000).toISOString()
      : null;
    const cfg = config();
    const record = {
      instagram_user_id: profile.userId,
      app_id: cfg.appId,
      parent_app_id: cfg.parentAppId,
      username: profile.username,
      token_ciphertext: encrypted.ciphertext,
      token_iv: encrypted.iv,
      token_auth_tag: encrypted.authTag,
      scopes: JSON.stringify(scopes),
      created_at: new Date(currentTime).toISOString(),
      updated_at: new Date(currentTime).toISOString(),
      expires_at: expiresAt,
    };
    if (credentialStore) {
      credentialStore.set(profile.userId, record);
      return record;
    }
    if (!await prepareCredentialStorage()) throw new Error('credential_storage_unavailable');
    const database = await getDatabase();
    await database.query(`
      INSERT INTO ${CREDENTIAL_TABLE}
        (instagram_user_id, app_id, parent_app_id, username, token_ciphertext, token_iv, token_auth_tag, scopes, created_at, updated_at, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (instagram_user_id) DO UPDATE SET
        app_id = EXCLUDED.app_id,
        parent_app_id = EXCLUDED.parent_app_id,
        username = EXCLUDED.username,
        token_ciphertext = EXCLUDED.token_ciphertext,
        token_iv = EXCLUDED.token_iv,
        token_auth_tag = EXCLUDED.token_auth_tag,
        scopes = EXCLUDED.scopes,
        updated_at = EXCLUDED.updated_at,
        expires_at = EXCLUDED.expires_at
    `, [
      record.instagram_user_id,
      record.app_id,
      record.parent_app_id,
      record.username,
      record.token_ciphertext,
      record.token_iv,
      record.token_auth_tag,
      record.scopes,
      record.created_at,
      record.updated_at,
      record.expires_at,
    ]);
    return record;
  }

  async function loadCredential(expectedUserId) {
    if (!await prepareCredentialStorage()) throw new Error('credential_storage_unavailable');
    if (credentialStore) return credentialStore.get(expectedUserId) || null;
    const database = await getDatabase();
    const result = await database.query(
      `SELECT instagram_user_id, app_id, parent_app_id, username, token_ciphertext, token_iv, token_auth_tag, scopes, created_at, updated_at, expires_at FROM ${CREDENTIAL_TABLE} WHERE instagram_user_id = $1 LIMIT 1`,
      [expectedUserId],
    );
    return result?.rows?.[0] || null;
  }

  async function restoreCredentialOnBoot() {
    const cfg = config();
    if (!credentialKey()) return { restored: false, reason: 'credential_encryption_unavailable' };
    try {
      const record = await loadCredential(cfg.expectedUserId);
      if (!record) return { restored: false, reason: 'credential_not_stored' };
      if (String(record.app_id || '') !== cfg.appId || String(record.parent_app_id || '') !== cfg.parentAppId || String(record.username || '') !== cfg.expectedUsername) {
        throw new Error('credential_context_mismatch');
      }
      let storedScopes;
      try { storedScopes = JSON.parse(String(record.scopes || '[]')); } catch { throw new Error('credential_scope_metadata_invalid'); }
      if (!Array.isArray(storedScopes) || !REQUIRED_SCOPES.every((scope) => storedScopes.includes(scope))) throw new Error('credential_scope_metadata_invalid');
      let token = decryptCredential(record);
      let expiresIn = null;
      const expiresAtMs = record.expires_at ? Date.parse(record.expires_at) : NaN;
      if (Number.isFinite(expiresAtMs) && expiresAtMs - now() <= CREDENTIAL_REFRESH_WINDOW) {
        try {
          const refreshed = await refreshAccessToken(token, cfg, fetchImpl);
          token = String(refreshed.access_token);
          expiresIn = refreshed.expires_in;
        } catch (error) {
          if (expiresAtMs <= now()) throw error;
        }
      }
      const profile = await readProfile(token, cfg, fetchImpl);
      const subscription = await readSubscription(token, cfg, fetchImpl);
      if (!subscription.messages_account_subscribed) throw new Error('instagram_messages_permission_missing');
      if (expiresIn !== null) await saveCredential(profile, token, REQUIRED_SCOPES, expiresIn, now());
      const sessionId = `durable:${profile.userId}`;
      sessions.set(sessionId, {
        token,
        profile,
        tokenType: 'Instagram User Access Token',
        scopes: [...REQUIRED_SCOPES],
        createdAt: Date.parse(record.created_at) || now(),
        expiresIn: expiresIn === null && Number.isFinite(expiresAtMs) ? Math.max(0, Math.floor((expiresAtMs - now()) / 1000)) : Number(expiresIn) || null,
      });
      logEvent('instagram_credential_restored', { instagram_user_id: profile.userId, username: profile.username, messaging_permission: 'PASS' });
      return { restored: true, username: profile.username, instagram_user_id: profile.userId, messaging_permission: 'PASS' };
    } catch (error) {
      logEvent('instagram_credential_restore_failed', { code: error?.message || 'credential_restore_failed' });
      return { restored: false, reason: error?.message || 'credential_restore_failed' };
    }
  }

  async function saveOAuthState(state, currentTime) {
    if (stateStore) {
      pruneOAuthStates(stateStore, currentTime);
      stateStore.set(state, {
        created_at: new Date(currentTime).toISOString(),
        used: false,
        correlation_reference: `oauth:${hash(state).slice(0, 16)}`,
      });
      return true;
    }
    if (!await prepareStateStorage()) return false;
    const database = await getDatabase();
    await database.query(
      `INSERT INTO ${STATE_TABLE} (state, created_at, used, correlation_reference) VALUES ($1, $2, FALSE, $3)`,
      [state, new Date(currentTime), `oauth:${hash(state).slice(0, 16)}`],
    );
    return true;
  }

  async function consumeStoredOAuthState(state, currentTime) {
    if (!state) return false;
    if (stateStore) return consumeOAuthState(stateStore, state, currentTime);
    if (!await prepareStateStorage()) return false;
    const database = await getDatabase();
    const cutoff = new Date(currentTime - STATE_MAX_AGE * 1000);
    await database.query(`DELETE FROM ${STATE_TABLE} WHERE used = TRUE OR created_at <= $1`, [cutoff]);
    const result = await database.query(
      `UPDATE ${STATE_TABLE} SET used = TRUE, used_at = $2 WHERE state = $1 AND used = FALSE AND created_at > $3 RETURNING correlation_reference`,
      [state, new Date(currentTime), cutoff],
    );
    return Array.isArray(result?.rows) && result.rows.length === 1;
  }

  const handler = async function instagramOAuthHandler(req, res, requestUrl) {
    const cfg = config();
    const stateSecret = cfg.stateSecret;

    if (requestUrl.pathname === START_PATH) {
      if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
      if (!cfg.stateSecret || !cfg.redirectUri) return json(res, 503, { error: 'oauth_configuration_unavailable' });
      const currentTime = now();
      if (!await prepareStateStorage()) return json(res, 503, { error: 'oauth_state_storage_unavailable' });
      const state = randomBytes(32).toString('base64url');
      try {
        await saveOAuthState(state, currentTime);
      } catch { return json(res, 503, { error: 'oauth_state_storage_unavailable' }); }
      const authorizeUrl = new URL('https://www.instagram.com/oauth/authorize');
      authorizeUrl.searchParams.set('client_id', cfg.appId);
      authorizeUrl.searchParams.set('redirect_uri', cfg.redirectUri);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', REQUIRED_SCOPES.join(','));
      authorizeUrl.searchParams.set('state', state);
      logEvent('instagram_oauth_started', { app_id: cfg.appId, redirect_uri_configured: true, scopes: REQUIRED_SCOPES });
      res.statusCode = 302;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Location', authorizeUrl.toString());
      return res.end();
    }

    if (requestUrl.pathname === CALLBACK_PATH) {
      if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
      if (!cfg.appSecret || !cfg.stateSecret || !cfg.redirectUri) return json(res, 503, { error: 'oauth_configuration_unavailable' });
      const state = requestUrl.searchParams.get('state') || '';
      let stateAccepted = false;
      try { stateAccepted = await consumeStoredOAuthState(state, now()); } catch { return json(res, 503, { error: 'oauth_state_storage_unavailable' }); }
      if (!stateAccepted) return json(res, 400, { error: 'invalid_oauth_state' });
      if (requestUrl.searchParams.get('error')) return json(res, 400, { error: 'instagram_authorization_denied' });
      const code = requestUrl.searchParams.get('code') || '';
      if (!code) return json(res, 400, { error: 'missing_authorization_code' });
      let oauthStage = 'token_exchange';
      try {
        const tokenResponse = await exchangeCode(code, cfg, fetchImpl);
        oauthStage = 'identity_validation';
        const profile = await readProfile(tokenResponse.access_token, cfg, fetchImpl);
        oauthStage = 'account_subscription_query';
        let subscription = await readSubscription(tokenResponse.access_token, cfg, fetchImpl);
        let minimumSubscriptionFixApplied = false;
        if (!subscription.messages_account_subscribed) {
          oauthStage = 'minimum_subscription_fix';
          await subscribeMessages(tokenResponse.access_token, cfg, fetchImpl);
          oauthStage = 'account_subscription_requery';
          subscription = await readSubscriptionUntilMessages(tokenResponse.access_token, cfg, fetchImpl);
          minimumSubscriptionFixApplied = true;
        }
        if (!subscription.messages_account_subscribed) throw new Error('instagram_messages_subscription_missing');
        await saveCredential(profile, tokenResponse.access_token, REQUIRED_SCOPES, tokenResponse.expires_in, now());
        const sessionId = randomBytes(24).toString('base64url');
        sessions.set(sessionId, {
          token: tokenResponse.access_token,
          profile,
          tokenType: 'Instagram User Access Token',
          scopes: [...REQUIRED_SCOPES],
          createdAt: now(),
          expiresIn: Number.isFinite(Number(tokenResponse.expires_in)) ? Number(tokenResponse.expires_in) : null,
        });
        setCookie(res, SESSION_COOKIE, signedValue(sessionId, stateSecret), { maxAge: STATE_MAX_AGE });
        logEvent('instagram_oauth_token_acquired', { app_id: cfg.appId, instagram_user_id: profile.userId, username: profile.username, subscription_query: subscription.query, messages_account_subscribed: subscription.messages_account_subscribed, minimum_subscription_fix_applied: minimumSubscriptionFixApplied });
        return json(res, 200, {
          ok: true,
          token_acquired: true,
          token_type: 'Instagram User Access Token',
          token_scopes: [...REQUIRED_SCOPES],
          token_host_compatibility: 'PASS',
          instagram_user_id: profile.userId,
          username: profile.username,
          account_subscription: subscription,
          minimum_subscription_fix_applied: minimumSubscriptionFixApplied,
          token_storage: 'durable_encrypted',
        });
      } catch (error) {
        const failureCode = error && error.message ? error.message : 'oauth_failed';
        logEvent('instagram_oauth_failed', { stage: oauthStage, failure_code: failureCode });
        const failureStatus = {
          token_exchange: 520,
          identity_validation: 521,
          account_subscription_query: 522,
          minimum_subscription_fix: 523,
          account_subscription_requery: 524,
        }[oauthStage] || 502;
        return json(res, failureStatus, { error: failureCode === 'unexpected_instagram_account' ? 'unexpected_instagram_account' : 'instagram_oauth_failed', failure_stage: oauthStage });
      }
    }

    if (requestUrl.pathname === STATUS_PATH) {
      if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
      if (!cfg.stateSecret) return json(res, 503, { error: 'oauth_configuration_unavailable' });
      const sessionId = verifySignedValue(cookieValue(req, SESSION_COOKIE), stateSecret);
      const session = sessionId ? sessions.get(sessionId) : null;
      if (!session) return json(res, 401, { error: 'oauth_session_required' });
      try {
        const subscription = await readSubscription(session.token, cfg, fetchImpl);
        return json(res, 200, {
          ok: true,
          token_acquired: true,
          token_type: session.tokenType,
          token_scopes: [...session.scopes],
          token_host_compatibility: 'PASS',
          instagram_user_id: session.profile.userId,
          username: session.profile.username,
          account_subscription: subscription,
          token_storage: 'durable_encrypted',
        });
      } catch (error) {
        logEvent('instagram_oauth_status_failed', { code: error && error.message ? error.message : 'status_failed' });
        return json(res, 502, { error: 'instagram_subscription_query_failed' });
      }
    }

    return text(res, 404, 'not_found');
  };
  handler.getActiveSession = (expectedUserId = '') => {
    for (const session of sessions.values()) {
      if (!expectedUserId || session?.profile?.userId === expectedUserId) return session;
    }
    return null;
  };
  handler.restoreCredentialOnBoot = restoreCredentialOnBoot;
  return handler;
}

module.exports = createInstagramOAuthHandler();
module.exports.createInstagramOAuthHandler = createInstagramOAuthHandler;
module.exports.REQUIRED_SCOPES = REQUIRED_SCOPES;
module.exports.paths = { START_PATH, CALLBACK_PATH, STATUS_PATH };
