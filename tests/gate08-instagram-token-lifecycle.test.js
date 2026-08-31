'use strict';

const assert = require('assert');
const { URL } = require('url');
const { createInstagramOAuthHandler, REQUIRED_SCOPES } = require('../api/omega/social/instagram-oauth');

const APP_ID = '4296194637360399';
const USER_ID = '17841433759878333';
const USERNAME = 'campus.enfermeria';
const REDIRECT_URI = 'https://staging.example.test/oauth/gate08/instagram/callback';
const SECRET = 'synthetic-app-secret';
const ENCRYPTION_KEY = 'synthetic-encryption-key';
const SHORT_TOKEN = 'synthetic-short-token';
const LONG_TOKEN = 'synthetic-long-token';
const REFRESHED_TOKEN = 'synthetic-refreshed-token';
const START_TIME = Date.parse('2026-08-31T12:00:00.000Z');
const LONG_LIVED_EXPIRES_IN = 5_184_000;

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

function configureEnvironment() {
  process.env.INSTAGRAM_LOGIN_APP_ID = APP_ID;
  process.env.INSTAGRAM_LOGIN_APP_SECRET = SECRET;
  process.env.INSTAGRAM_LOGIN_REDIRECT_URI = REDIRECT_URI;
  process.env.INSTAGRAM_LOGIN_EXPECTED_IG_USER_ID = USER_ID;
  process.env.INSTAGRAM_LOGIN_EXPECTED_IG_USERNAME = USERNAME;
  process.env.INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY = ENCRYPTION_KEY;
}

function fetchFixture(options = {}) {
  const calls = [];
  const refreshMode = options.refreshMode || 'success';
  const profileMode = options.profileMode || 'success';
  return {
    calls,
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      const method = init.method || 'GET';
      const authorization = init.headers?.Authorization || null;
      calls.push({ url, method, authorization });
      if (url === 'https://api.instagram.com/oauth/access_token') return {
        ok: true,
        status: 200,
        async json() { return { access_token: SHORT_TOKEN, expires_in: 3600 }; },
      };
      if (url.startsWith('https://graph.instagram.com/access_token?')) return {
        ok: true,
        status: 200,
        async json() { return { access_token: LONG_TOKEN, token_type: 'bearer', expires_in: LONG_LIVED_EXPIRES_IN }; },
      };
      if (url.startsWith('https://graph.instagram.com/refresh_access_token?')) {
        if (refreshMode === 'failure') return { ok: false, status: 401, async json() { return { error: { code: 190 } }; } };
        return { ok: true, status: 200, async json() { return { access_token: REFRESHED_TOKEN, token_type: 'bearer', expires_in: LONG_LIVED_EXPIRES_IN }; } };
      }
      if (url.includes('/me?')) {
        if (profileMode === 'failure') return { ok: false, status: 401, async json() { return { error: { code: 190 } }; } };
        return {
          ok: true,
          status: 200,
          async json() { return { id: USER_ID, username: USERNAME, account_type: 'BUSINESS' }; },
        };
      }
      if (new URL(url).pathname.endsWith(`/${USER_ID}/subscribed_apps`)) return {
        ok: true,
        status: 200,
        async json() { return { data: [{ application: { id: APP_ID }, subscribed_fields: ['messages'] }] }; },
      };
      throw new Error(`unexpected_fetch:${url}`);
    },
  };
}

async function seedCredential(credentialStore, currentTime) {
  const fixture = fetchFixture();
  const stateStore = new Map();
  let sequence = 0;
  const handler = createInstagramOAuthHandler({
    fetchImpl: fixture.fetchImpl,
    stateStore,
    credentialStore,
    randomBytes: () => Buffer.from(`seed-${++sequence}`.padEnd(32, 'x')),
    now: () => currentTime,
  });
  const start = responseCapture();
  await handler(request('GET'), start, new URL('https://staging.example.test/oauth/gate08/instagram'));
  const state = new URL(start.headers.Location).searchParams.get('state');
  const callbackUrl = new URL(REDIRECT_URI);
  callbackUrl.searchParams.set('code', 'synthetic-code');
  callbackUrl.searchParams.set('state', state);
  const callback = responseCapture();
  await handler(request('GET'), callback, callbackUrl);
  assert.equal(callback.statusCode, 200);
  return credentialStore.get(USER_ID);
}

function ageAndExpiry(record, issuedAt, expiresAt) {
  record.issued_at = new Date(issuedAt).toISOString();
  record.expires_at = new Date(expiresAt).toISOString();
  record.expires_in = Math.floor((expiresAt - issuedAt) / 1000);
  record.token_kind = 'LONG_LIVED';
}

async function restoreWith(record, options = {}) {
  const credentialStore = new Map([[USER_ID, record]]);
  const fixture = fetchFixture(options);
  const sessions = new Map();
  const handler = createInstagramOAuthHandler({
    fetchImpl: fixture.fetchImpl,
    credentialStore,
    sessions,
    randomBytes: () => Buffer.from('restore-sequence'.padEnd(32, 'x')),
    now: () => options.currentTime || START_TIME,
  });
  const result = await handler.restoreCredentialOnBoot();
  return { result, fixture, credentialStore, sessions, handler };
}

async function run() {
  configureEnvironment();
  const initialStore = new Map();
  const initial = await seedCredential(initialStore, START_TIME);
  assert.equal(initial.token_kind, 'LONG_LIVED');
  assert.equal(initial.expires_in, LONG_LIVED_EXPIRES_IN);
  assert.equal(initial.issued_at, new Date(START_TIME).toISOString());
  assert.equal(initial.last_validated_at, new Date(START_TIME).toISOString());

  const under24 = { ...initial };
  ageAndExpiry(under24, START_TIME - 6 * 60 * 60 * 1000, START_TIME + 30 * 24 * 60 * 60 * 1000);
  const under24Result = await restoreWith(under24);
  assert.equal(under24Result.result.restored, true);
  assert.equal(under24Result.fixture.calls.some((call) => call.url.includes('/refresh_access_token?')), false);

  const over24MoreThan10 = { ...initial };
  ageAndExpiry(over24MoreThan10, START_TIME - 2 * 24 * 60 * 60 * 1000, START_TIME + 11 * 24 * 60 * 60 * 1000);
  const over24Result = await restoreWith(over24MoreThan10);
  assert.equal(over24Result.result.restored, true);
  assert.equal(over24Result.fixture.calls.some((call) => call.url.includes('/refresh_access_token?')), false);

  const nearExpiry = { ...initial };
  ageAndExpiry(nearExpiry, START_TIME - 2 * 24 * 60 * 60 * 1000, START_TIME + 5 * 24 * 60 * 60 * 1000);
  const refreshResult = await restoreWith(nearExpiry);
  assert.equal(refreshResult.result.restored, true);
  assert.equal(refreshResult.fixture.calls.some((call) => call.url.includes('/refresh_access_token?')), true);
  assert.equal(refreshResult.sessions.get(`durable:${USER_ID}`).token, REFRESHED_TOKEN);
  assert.equal(refreshResult.credentialStore.get(USER_ID).token_kind, 'LONG_LIVED');
  assert.equal(refreshResult.credentialStore.get(USER_ID).expires_in, LONG_LIVED_EXPIRES_IN);
  assert.equal(refreshResult.credentialStore.get(USER_ID).issued_at, new Date(START_TIME).toISOString());

  const refreshFailure = { ...nearExpiry };
  const previousCiphertext = refreshFailure.token_ciphertext;
  const failedRefresh = await restoreWith(refreshFailure, { refreshMode: 'failure' });
  assert.equal(failedRefresh.result.restored, true);
  assert.equal(failedRefresh.sessions.get(`durable:${USER_ID}`).token, LONG_TOKEN);
  assert.equal(failedRefresh.credentialStore.get(USER_ID).token_ciphertext, previousCiphertext);

  const invalidLive = { ...initial };
  ageAndExpiry(invalidLive, START_TIME - 2 * 24 * 60 * 60 * 1000, START_TIME + 30 * 24 * 60 * 60 * 1000);
  const invalidResult = await restoreWith(invalidLive, { profileMode: 'failure' });
  assert.equal(invalidResult.result.restored, false);
  assert.equal(invalidResult.result.reason, 'profile_validation_failed');
  assert.equal(invalidResult.fixture.calls.some((call) => call.url.includes('/refresh_access_token?')), false);

  const maintenance = createInstagramOAuthHandler({ credentialStore: new Map(), fetchImpl: fetchFixture().fetchImpl, now: () => START_TIME });
  assert.equal(maintenance.startCredentialMaintenance(), true);
  assert.equal(maintenance.startCredentialMaintenance(), true);

  const refreshUrl = refreshResult.fixture.calls.find((call) => call.url.includes('/refresh_access_token?')).url;
  assert.equal(new URL(refreshUrl).searchParams.get('grant_type'), 'ig_refresh_token');
  assert.equal(new URL(refreshUrl).searchParams.get('access_token'), LONG_TOKEN);
  assert.equal(REQUIRED_SCOPES.length, 2);

  console.log('instagram durable token lifecycle: 11/11 PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
