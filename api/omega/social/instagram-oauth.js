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
const CREDENTIAL_VALIDATION_INTERVAL = 24 * 60 * 60 * 1000;
const CREDENTIAL_REFRESH_THRESHOLD_DAYS = 10;
const CREDENTIAL_REFRESH_THRESHOLD_MS = CREDENTIAL_REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
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
      expires_at TIMESTAMPTZ,
      token_kind TEXT,
      issued_at TIMESTAMPTZ,
      expires_in INTEGER,
      last_validated_at TIMESTAMPTZ
    )
  `);
  await database.query(`ALTER TABLE ${CREDENTIAL_TABLE} ADD COLUMN IF NOT EXISTS token_kind TEXT`);
  await database.query(`ALTER TABLE ${CREDENTIAL_TABLE} ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ`);
  await database.query(`ALTER TABLE ${CREDENTIAL_TABLE} ADD COLUMN IF NOT EXISTS expires_in INTEGER`);
  await database.query(`ALTER TABLE ${CREDENTIAL_TABLE} ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ`);
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

async function exchangeLongLivedToken(shortLivedToken, cfg, fetchImpl) {
  const url = new URL(`${cfg.graphBase}/access_token`);
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', cfg.appSecret);
  url.searchParams.set('access_token', String(shortLivedToken));
  const response = await fetchImpl(url, { method: 'GET' });
  const data = await readJson(response);
  if (!response.ok || !data?.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) {
    throw new Error('long_lived_token_exchange_failed');
  }
  return {
    access_token: String(data.access_token),
    token_type: data.token_type || 'bearer',
    expires_in: Number(data.expires_in),
  };
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
  let maintenanceTimer = null;
  let maintenanceInFlight = false;

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

  async function saveCredential(profile, token, scopes, expiresIn, currentTime, metadata = {}) {
    const encrypted = encryptCredential(token, randomBytes);
    const normalizedExpiresIn = Number.isFinite(Number(expiresIn)) && Number(expiresIn) > 0
      ? Math.floor(Number(expiresIn))
      : null;
    const issuedAt = Number.isFinite(Number(metadata.issuedAt)) ? Number(metadata.issuedAt) : currentTime;
    const expiresAt = normalizedExpiresIn !== null
      ? new Date(issuedAt + normalizedExpiresIn * 1000).toISOString()
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
      created_at: metadata.createdAt || new Date(currentTime).toISOString(),
      updated_at: new Date(currentTime).toISOString(),
      expires_at: expiresAt,
      token_kind: metadata.tokenKind || 'LONG_LIVED',
      issued_at: new Date(issuedAt).toISOString(),
      expires_in: normalizedExpiresIn,
      last_validated_at: new Date(Number.isFinite(Number(metadata.lastValidatedAt)) ? Number(metadata.lastValidatedAt) : currentTime).toISOString(),
    };
    if (credentialStore) {
      credentialStore.set(profile.userId, record);
      return record;
    }
    if (!await prepareCredentialStorage()) throw new Error('credential_storage_unavailable');
    const database = await getDatabase();
    await database.query(`
      INSERT INTO ${CREDENTIAL_TABLE}
        (instagram_user_id, app_id, parent_app_id, username, token_ciphertext, token_iv, token_auth_tag, scopes, created_at, updated_at, expires_at, token_kind, issued_at, expires_in, last_validated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (instagram_user_id) DO UPDATE SET
        app_id = EXCLUDED.app_id,
        parent_app_id = EXCLUDED.parent_app_id,
        username = EXCLUDED.username,
        token_ciphertext = EXCLUDED.token_ciphertext,
        token_iv = EXCLUDED.token_iv,
        token_auth_tag = EXCLUDED.token_auth_tag,
        scopes = EXCLUDED.scopes,
        updated_at = EXCLUDED.updated_at,
        expires_at = EXCLUDED.expires_at,
        token_kind = EXCLUDED.token_kind,
        issued_at = EXCLUDED.issued_at,
        expires_in = EXCLUDED.expires_in,
        last_validated_at = EXCLUDED.last_validated_at
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
      record.token_kind,
      record.issued_at,
      record.expires_in,
      record.last_validated_at,
    ]);
    return record;
  }

  async function markValidated(record, currentTime) {
    const validatedAt = new Date(currentTime).toISOString();
    if (credentialStore) {
      credentialStore.set(record.instagram_user_id, { ...record, last_validated_at: validatedAt });
      return;
    }
    if (!await prepareCredentialStorage()) throw new Error('credential_storage_unavailable');
    const database = await getDatabase();
    await database.query(
      `UPDATE ${CREDENTIAL_TABLE} SET last_validated_at = $2, updated_at = $2 WHERE instagram_user_id = $1`,
      [record.instagram_user_id, validatedAt],
    );
  }

  async function loadCredential(expectedUserId) {
    if (!await prepareCredentialStorage()) throw new Error('credential_storage_unavailable');
    if (credentialStore) return credentialStore.get(expectedUserId) || null;
    const database = await getDatabase();
    const result = await database.query(
      `SELECT instagram_user_id, app_id, parent_app_id, username, token_ciphertext, token_iv, token_auth_tag, scopes, created_at, updated_at, expires_at, token_kind, issued_at, expires_in, last_validated_at FROM ${CREDENTIAL_TABLE} WHERE instagram_user_id = $1 LIMIT 1`,
      [expectedUserId],
    );
    return result?.rows?.[0] || null;
  }

  async function restoreCredentialOnBoot() {
    const cfg = config();
    if (!credentialKey()) return { restored: false, reason: 'credential_encryption_unavailable' };
    const currentTime = now();
    try {
      const record = await loadCredential(cfg.expectedUserId);
      if (!record) return { restored: false, reason: 'credential_not_stored' };
      if (String(record.app_id || '') !== cfg.appId || String(record.parent_app_id || '') !== cfg.parentAppId || String(record.username || '') !== cfg.expectedUsername) {
        throw new Error('credential_context_mismatch');
      }
      let storedScopes;
      try { storedScopes = JSON.parse(String(record.scopes || '[]')); } catch { throw new Error('credential_scope_metadata_invalid'); }
      if (!Array.isArray(storedScopes) || !REQUIRED_SCOPES.every((scope) => storedScopes.includes(scope))) throw new Error('credential_scope_metadata_invalid');
      const originalToken = decryptCredential(record);
      const issuedAtMs = Date.parse(record.issued_at || record.created_at || '');
      const expiresAtMs = Date.parse(record.expires_at || '');
      const ageMs = Number.isFinite(issuedAtMs) ? Math.max(0, currentTime - issuedAtMs) : null;
      const remainingMs = Number.isFinite(expiresAtMs) ? expiresAtMs - currentTime : null;
      const tokenKind = String(record.token_kind || 'LEGACY');
      const daysRemaining = remainingMs === null ? null : Math.floor(remainingMs / (24 * 60 * 60 * 1000));
      const refreshEligible = tokenKind === 'LONG_LIVED'
        && ageMs !== null
        && ageMs >= CREDENTIAL_VALIDATION_INTERVAL
        && remainingMs !== null
        && remainingMs >= 0
        && remainingMs <= CREDENTIAL_REFRESH_THRESHOLD_MS;
      let token = originalToken;
      let expiresIn = Number.isFinite(Number(record.expires_in)) ? Number(record.expires_in) : null;
      let issuedAt = issuedAtMs;
      let refreshAttempted = false;
      let refreshResult = 'NOT_ELIGIBLE';
      const lifecycle = {
        instagram_token_kind: tokenKind,
        instagram_token_valid: false,
        instagram_token_issued_at: Number.isFinite(issuedAtMs) ? new Date(issuedAtMs).toISOString() : null,
        instagram_token_expires_at: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null,
        instagram_token_days_remaining: daysRemaining,
        instagram_token_last_validated_at: record.last_validated_at || null,
        instagram_token_refresh_eligible: refreshEligible,
        instagram_token_refresh_attempted: false,
        instagram_token_refresh_result: refreshResult,
      };
      const profile = await readProfile(token, cfg, fetchImpl);
      lifecycle.instagram_token_valid = true;
      if (refreshEligible) {
        refreshAttempted = true;
        lifecycle.instagram_token_refresh_attempted = true;
        try {
          const refreshed = await refreshAccessToken(token, cfg, fetchImpl);
          token = String(refreshed.access_token);
          expiresIn = Number(refreshed.expires_in);
          issuedAt = currentTime;
          refreshResult = 'PASS';
          lifecycle.instagram_token_refresh_result = refreshResult;
          lifecycle.instagram_token_kind = 'LONG_LIVED';
          lifecycle.instagram_token_issued_at = new Date(issuedAt).toISOString();
          lifecycle.instagram_token_expires_at = new Date(currentTime + expiresIn * 1000).toISOString();
          lifecycle.instagram_token_days_remaining = Math.floor(expiresIn / (24 * 60 * 60));
          lifecycle.instagram_token_last_validated_at = new Date(currentTime).toISOString();
          const refreshedProfile = await readProfile(token, cfg, fetchImpl);
          if (refreshedProfile.userId !== profile.userId || refreshedProfile.username !== profile.username) throw new Error('unexpected_instagram_account');
        } catch (error) {
          refreshResult = 'FAIL';
          lifecycle.instagram_token_refresh_result = refreshResult;
          logEvent('instagram_credential_refresh_failed', { code: error?.message || 'credential_refresh_failed', ...lifecycle });
        }
      }
      const subscription = await readSubscription(token, cfg, fetchImpl);
      if (!subscription.messages_account_subscribed) throw new Error('instagram_messages_permission_missing');
      if (refreshAttempted && refreshResult === 'PASS') {
        await saveCredential(profile, token, REQUIRED_SCOPES, expiresIn, currentTime, {
          tokenKind: 'LONG_LIVED',
          issuedAt,
          createdAt: record.created_at,
          lastValidatedAt: currentTime,
        });
      } else {
        await markValidated(record, currentTime);
      }
      const sessionId = `durable:${profile.userId}`;
      sessions.set(sessionId, {
        token,
        profile,
        tokenType: 'Instagram User Access Token',
        scopes: [...REQUIRED_SCOPES],
        createdAt: Date.parse(record.created_at) || currentTime,
        expiresIn: expiresIn === null && Number.isFinite(expiresAtMs) ? Math.max(0, Math.floor((expiresAtMs - currentTime) / 1000)) : Number(expiresIn) || null,
      });
      logEvent('instagram_credential_lifecycle', { ...lifecycle, instagram_token_valid: true, instagram_token_refresh_attempted: refreshAttempted, instagram_token_refresh_result: refreshResult });
      logEvent('instagram_credential_restored', { instagram_user_id: profile.userId, username: profile.username, messaging_permission: 'PASS', token_kind: lifecycle.instagram_token_kind });
      return { restored: true, username: profile.username, instagram_user_id: profile.userId, messaging_permission: 'PASS' };
    } catch (error) {
      if (error?.message === 'profile_validation_failed' || error?.message === 'unexpected_instagram_account') {
        sessions.delete(`durable:${cfg.expectedUserId}`);
        logEvent('instagram_credential_marked_invalid', { status: 'INVALID_REAUTH_REQUIRED', reason: error.message });
      }
      logEvent('instagram_credential_restore_failed', { code: error?.message || 'credential_restore_failed', validated_at: new Date(currentTime).toISOString() });
      return { restored: false, reason: error?.message || 'credential_restore_failed' };
    }
  }

  function startCredentialMaintenance() {
    if (maintenanceTimer) return true;
    maintenanceTimer = setInterval(async () => {
      if (maintenanceInFlight) return;
      maintenanceInFlight = true;
      try { await restoreCredentialOnBoot(); } finally { maintenanceInFlight = false; }
    }, CREDENTIAL_VALIDATION_INTERVAL);
    if (typeof maintenanceTimer.unref === 'function') maintenanceTimer.unref();
    return true;
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
        oauthStage = 'long_lived_token_exchange';
        const longLivedToken = await exchangeLongLivedToken(tokenResponse.access_token, cfg, fetchImpl);
        oauthStage = 'identity_validation';
        const profile = await readProfile(longLivedToken.access_token, cfg, fetchImpl);
        oauthStage = 'account_subscription_query';
        let subscription = await readSubscription(longLivedToken.access_token, cfg, fetchImpl);
        let minimumSubscriptionFixApplied = false;
        if (!subscription.messages_account_subscribed) {
          oauthStage = 'minimum_subscription_fix';
          await subscribeMessages(longLivedToken.access_token, cfg, fetchImpl);
          oauthStage = 'account_subscription_requery';
          subscription = await readSubscriptionUntilMessages(longLivedToken.access_token, cfg, fetchImpl);
          minimumSubscriptionFixApplied = true;
        }
        if (!subscription.messages_account_subscribed) throw new Error('instagram_messages_subscription_missing');
        const issuedAt = now();
        await saveCredential(profile, longLivedToken.access_token, REQUIRED_SCOPES, longLivedToken.expires_in, issuedAt, {
          tokenKind: 'LONG_LIVED',
          issuedAt,
          lastValidatedAt: issuedAt,
        });
        const sessionId = randomBytes(24).toString('base64url');
        sessions.set(sessionId, {
          token: longLivedToken.access_token,
          profile,
          tokenType: 'Instagram User Access Token',
          scopes: [...REQUIRED_SCOPES],
          createdAt: issuedAt,
          expiresIn: longLivedToken.expires_in,
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
          long_lived_token_exchange: 520,
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
  handler.startCredentialMaintenance = startCredentialMaintenance;
  return handler;
}

module.exports = createInstagramOAuthHandler();
module.exports.createInstagramOAuthHandler = createInstagramOAuthHandler;
module.exports.REQUIRED_SCOPES = REQUIRED_SCOPES;
module.exports.CREDENTIAL_REFRESH_THRESHOLD_DAYS = CREDENTIAL_REFRESH_THRESHOLD_DAYS;
module.exports.paths = { START_PATH, CALLBACK_PATH, STATUS_PATH };
