'use strict';

const assert = require('assert');
const { URL } = require('url');
const { createInstagramOAuthHandler, REQUIRED_SCOPES } = require('../api/omega/social/instagram-oauth');

const APP_ID = '4296194637360399';
const USER_ID = '17841433759878333';
const USERNAME = 'campus.enfermeria';
const SECRET = 'synthetic-instagram-login-app-secret';
const REDIRECT_URI = 'https://staging.example.test/oauth/gate08/instagram/callback';
const TOKEN = 'synthetic-instagram-login-access-token';
const ENCRYPTION_KEY = 'synthetic-instagram-credential-encryption-key';

function responseCapture() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = String(value || ''); },
  };
}

function request(method, headers = {}) {
  return { method, headers, async *[Symbol.asyncIterator]() {} };
}

function envSetup() {
  process.env.INSTAGRAM_LOGIN_APP_ID = APP_ID;
  process.env.INSTAGRAM_LOGIN_APP_SECRET = SECRET;
  process.env.INSTAGRAM_LOGIN_REDIRECT_URI = REDIRECT_URI;
  process.env.INSTAGRAM_LOGIN_EXPECTED_IG_USER_ID = USER_ID;
  process.env.INSTAGRAM_LOGIN_EXPECTED_IG_USERNAME = USERNAME;
  process.env.INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY = ENCRYPTION_KEY;
}

async function run() {
  envSetup();
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET', authorization: init.headers?.Authorization || null });
    if (url === 'https://api.instagram.com/oauth/access_token') return {
      ok: true,
      status: 200,
      async json() { return { access_token: TOKEN, user_id: USER_ID, expires_in: 5184000 }; },
    };
    if (url.startsWith('https://graph.instagram.com/access_token?')) return {
      ok: true,
      status: 200,
      async json() { return { access_token: TOKEN, token_type: 'bearer', expires_in: 5184000 }; },
    };
    if (url.includes('/me?')) return {
      ok: true,
      status: 200,
      async json() { return { id: USER_ID, username: USERNAME, account_type: 'BUSINESS' }; },
    };
    if (new URL(url).pathname.endsWith(`/${USER_ID}/subscribed_apps`)) return {
      ok: true,
      status: 200,
      async json() { return { data: [{ application: { id: APP_ID }, subscribed_fields: ['messages'] }] }; },
    };
    throw new Error(`unexpected_fetch:${url}`);
  };
  let sequence = 0;
  let currentTime = 1787842800000;
  const stateStore = new Map();
  const credentialStore = new Map();
  const handler = createInstagramOAuthHandler({ fetchImpl, stateStore, credentialStore, randomBytes: () => Buffer.from(`synthetic-${++sequence}`.padEnd(32, 'x')), now: () => currentTime });

  const startRes = responseCapture();
  await handler(request('GET'), startRes, new URL('https://staging.example.test/oauth/gate08/instagram'));
  assert.equal(startRes.statusCode, 302);
  const authorize = new URL(startRes.headers.Location);
  assert.equal(authorize.searchParams.get('client_id'), APP_ID);
  assert.equal(authorize.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(authorize.searchParams.get('scope'), REQUIRED_SCOPES.join(','));
  const state = authorize.searchParams.get('state');
  assert.equal(startRes.headers['Set-Cookie'], undefined);
  assert.deepEqual(stateStore.get(state), {
    created_at: new Date(currentTime).toISOString(),
    used: false,
    correlation_reference: `oauth:${require('crypto').createHash('sha256').update(state).digest('hex').slice(0, 16)}`,
  });

  const callbackUrl = new URL(REDIRECT_URI);
  callbackUrl.searchParams.set('code', 'synthetic-authorization-code');
  callbackUrl.searchParams.set('state', state);
  const callbackRes = responseCapture();
  await handler(request('GET'), callbackRes, callbackUrl);
  assert.equal(callbackRes.statusCode, 200);
  const callbackBody = JSON.parse(callbackRes.body);
  assert.equal(callbackBody.token_acquired, true);
  assert.equal(callbackBody.token_type, 'Instagram User Access Token');
  assert.deepEqual(callbackBody.token_scopes, REQUIRED_SCOPES);
  assert.equal(callbackBody.token_host_compatibility, 'PASS');
  assert.equal(callbackBody.instagram_user_id, USER_ID);
  assert.equal(callbackBody.username, USERNAME);
  assert.equal(callbackBody.account_subscription.messages_account_subscribed, true);
  assert.equal(callbackBody.account_subscription.current_subscribed_app, APP_ID);
  assert.equal(callbackBody.token_storage, 'durable_encrypted');
  assert.equal(callbackRes.body.includes(TOKEN), false);
  assert.equal(credentialStore.size, 1);
  const storedCredential = credentialStore.get(USER_ID);
  assert.equal(storedCredential.token_ciphertext.includes(TOKEN), false);
  assert.equal(storedCredential.token_iv.length > 0, true);
  assert.equal(storedCredential.token_auth_tag.length > 0, true);
  assert.equal(storedCredential.token_kind, 'LONG_LIVED');
  assert.equal(storedCredential.expires_in, 5184000);
  assert.equal(storedCredential.issued_at, new Date(currentTime).toISOString());
  assert.equal(storedCredential.last_validated_at, new Date(currentTime).toISOString());
  assert.equal(calls.filter((call) => call.authorization === `Bearer ${TOKEN}`).length, 2);
  assert.equal(callbackRes.headers['Set-Cookie'].length, 1);
  assert.match(callbackRes.headers['Set-Cookie'][0], /omega_gate08_ig_oauth_session=/);
  assert.equal(stateStore.get(state).used, true);

  const statusRes = responseCapture();
  await handler(request('GET', { cookie: callbackRes.headers['Set-Cookie'][0].split(';')[0] }), statusRes, new URL('https://staging.example.test/oauth/gate08/instagram/status'));
  assert.equal(statusRes.statusCode, 200);
  assert.equal(JSON.parse(statusRes.body).account_subscription.messages_account_subscribed, true);
  assert.equal(statusRes.body.includes(TOKEN), false);

  const restoredSessions = new Map();
  const restoredHandler = createInstagramOAuthHandler({ fetchImpl, credentialStore, sessions: restoredSessions, randomBytes: () => Buffer.from('restored-session'.padEnd(32, 'x')), now: () => currentTime });
  const restored = await restoredHandler.restoreCredentialOnBoot();
  assert.deepEqual(restored, { restored: true, username: USERNAME, instagram_user_id: USER_ID, messaging_permission: 'PASS' });
  assert.equal(restoredHandler.getActiveSession(USER_ID).token, TOKEN);

  const badStateRes = responseCapture();
  await handler(request('GET'), badStateRes, new URL(`${REDIRECT_URI}?code=ignored&state=wrong`));
  assert.equal(badStateRes.statusCode, 400);
  assert.equal(JSON.parse(badStateRes.body).error, 'invalid_oauth_state');

  const missingStateRes = responseCapture();
  await handler(request('GET'), missingStateRes, new URL(`${REDIRECT_URI}?code=ignored`));
  assert.equal(missingStateRes.statusCode, 400);
  assert.equal(JSON.parse(missingStateRes.body).error, 'invalid_oauth_state');

  const replayRes = responseCapture();
  await handler(request('GET'), replayRes, callbackUrl);
  assert.equal(replayRes.statusCode, 400);
  assert.equal(JSON.parse(replayRes.body).error, 'invalid_oauth_state');

  const expiredStateStore = new Map();
  let expiredNow = currentTime;
  const expiredHandler = createInstagramOAuthHandler({ fetchImpl, stateStore: expiredStateStore, randomBytes: () => Buffer.from('expired-state'.padEnd(32, 'x')), now: () => expiredNow });
  const expiredStartRes = responseCapture();
  await expiredHandler(request('GET'), expiredStartRes, new URL('https://staging.example.test/oauth/gate08/instagram'));
  const expiredState = new URL(expiredStartRes.headers.Location).searchParams.get('state');
  expiredNow += 601000;
  const expiredRes = responseCapture();
  const expiredUrl = new URL(REDIRECT_URI);
  expiredUrl.searchParams.set('code', 'ignored');
  expiredUrl.searchParams.set('state', expiredState);
  await expiredHandler(request('GET'), expiredRes, expiredUrl);
  assert.equal(expiredRes.statusCode, 400);
  assert.equal(JSON.parse(expiredRes.body).error, 'invalid_oauth_state');

  const databaseQueries = [];
  const database = {
    async query(sql, params) {
      databaseQueries.push({ sql: String(sql), params });
      if (String(sql).startsWith('UPDATE')) return { rows: [{ correlation_reference: 'oauth:test-reference' }] };
      return { rows: [] };
    },
  };
  let databaseSequence = 0;
  const databaseHandler = createInstagramOAuthHandler({
    fetchImpl,
    database,
    randomBytes: () => Buffer.from(`database-${++databaseSequence}`.padEnd(32, 'x')),
    now: () => currentTime,
  });
  const databaseStartRes = responseCapture();
  await databaseHandler(request('GET'), databaseStartRes, new URL('https://staging.example.test/oauth/gate08/instagram'));
  const databaseState = new URL(databaseStartRes.headers.Location).searchParams.get('state');
  assert.equal(databaseStartRes.statusCode, 302);
  const databaseCallbackRes = responseCapture();
  const databaseCallbackUrl = new URL(REDIRECT_URI);
  databaseCallbackUrl.searchParams.set('code', 'synthetic-database-authorization-code');
  databaseCallbackUrl.searchParams.set('state', databaseState);
  await databaseHandler(request('GET'), databaseCallbackRes, databaseCallbackUrl);
  assert.equal(databaseCallbackRes.statusCode, 200);
  assert.equal(databaseQueries.some((query) => query.sql.includes('CREATE TABLE IF NOT EXISTS')), true);
  assert.equal(databaseQueries.some((query) => query.sql.startsWith('INSERT INTO')), true);
  assert.equal(databaseQueries.some((query) => query.sql.startsWith('DELETE FROM')), true);
  assert.equal(databaseQueries.some((query) => query.sql.startsWith('UPDATE')), true);

  let subscriptionReads = 0;
  let subscriptionWrites = 0;
  const missingSubscriptionFetch = async (input, init = {}) => {
    const url = String(input);
    if (url === 'https://api.instagram.com/oauth/access_token') return {
      ok: true,
      status: 200,
      async json() { return { access_token: TOKEN, user_id: USER_ID, expires_in: 5184000 }; },
    };
    if (url.startsWith('https://graph.instagram.com/access_token?')) return {
      ok: true,
      status: 200,
      async json() { return { access_token: TOKEN, token_type: 'bearer', expires_in: 5184000 }; },
    };
    if (url.includes('/me?')) return {
      ok: true,
      status: 200,
      async json() { return { id: USER_ID, username: USERNAME, account_type: 'BUSINESS' }; },
    };
    if (new URL(url).pathname.endsWith(`/${USER_ID}/subscribed_apps`)) {
      if (init.method === 'POST') {
        subscriptionWrites += 1;
        const subscribeUrl = new URL(url);
        assert.equal(subscribeUrl.searchParams.get('subscribed_fields'), 'messages');
        assert.equal(init.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(init.body), { subscribed_fields: ['messages'] });
        return { ok: true, status: 200, async json() { return { success: true }; } };
      }
      subscriptionReads += 1;
      return {
        ok: true,
        status: 200,
        async json() { return { data: [{ application: { id: APP_ID }, subscribed_fields: subscriptionReads === 1 ? [] : ['messages'] }] }; },
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };
  const fixStateStore = new Map();
  const fixHandler = createInstagramOAuthHandler({
    fetchImpl: missingSubscriptionFetch,
    stateStore: fixStateStore,
    credentialStore: new Map(),
    randomBytes: () => Buffer.from('subscription-fix'.padEnd(32, 'x')),
    now: () => currentTime,
  });
  const fixStartRes = responseCapture();
  await fixHandler(request('GET'), fixStartRes, new URL('https://staging.example.test/oauth/gate08/instagram'));
  const fixState = new URL(fixStartRes.headers.Location).searchParams.get('state');
  const fixCallbackRes = responseCapture();
  const fixCallbackUrl = new URL(REDIRECT_URI);
  fixCallbackUrl.searchParams.set('code', 'synthetic-subscription-fix-code');
  fixCallbackUrl.searchParams.set('state', fixState);
  await fixHandler(request('GET'), fixCallbackRes, fixCallbackUrl);
  assert.equal(fixCallbackRes.statusCode, 200);
  const fixBody = JSON.parse(fixCallbackRes.body);
  assert.equal(fixBody.minimum_subscription_fix_applied, true);
  assert.equal(fixBody.account_subscription.messages_account_subscribed, true);
  assert.equal(subscriptionWrites, 1);
  assert.equal(subscriptionReads, 2);

  console.log('instagram oauth staging callback: PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
