'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { createInstagramIngressHandler, normalizePayload } = require('../api/_lib/instagram-social-ingress');

const FIXTURES = path.join(__dirname, '..', 'integrations', 'social', 'fixtures', 'instagram');
const USER_ID = '17841433759878333';
const APP_SECRET = 'synthetic-instagram-staging-app-secret';
const VERIFY_TOKEN = 'synthetic-instagram-staging-verify-token';

function fixture(name) { return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')); }
function signed(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
  return { body, headers: { 'x-hub-signature-256': `sha256=${signature}` } };
}
function responseCapture() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = String(value || ''); },
  };
}
function request(method, body, headers = {}) {
  return { method, body, headers, async *[Symbol.asyncIterator]() {} };
}

async function run() {
  process.env.INSTAGRAM_META_APP_SECRET = APP_SECRET;
  process.env.INSTAGRAM_LOGIN_APP_SECRET = APP_SECRET;
  process.env.INSTAGRAM_META_VERIFY_TOKEN = VERIFY_TOKEN;
  const replay = new Map();
  const handoffWrites = [];
  const sentOutbounds = [];
  const handler = createInstagramIngressHandler({
    replayStore: replay,
    persistHandoff: async (context) => { handoffWrites.push(context); return { status: 'WAITING_HUMAN' }; },
    findActiveHandoff: async () => null,
    sendOutbound: async (intent) => {
      sentOutbounds.push(intent);
      return { success: true, recipient_id: intent.recipient_id, message_id: 'synthetic-instagram-message-id', http_status: 200, meta_request_id: 'synthetic-meta-request-id', latency_ms: 1, correlation_id: intent.correlation_id };
    },
    now: () => 1787842800,
  });

  const valid = signed(fixture('01-valid-text.json'));
  const firstRes = responseCapture();
  await handler(request('POST', valid.body, valid.headers), firstRes, new URL('https://staging.test/webhook/gate08/instagram'));
  assert.equal(firstRes.statusCode, 200);
  const first = JSON.parse(firstRes.body);
  assert.equal(first.events[0].response.schema_version, 'OMEGA_CHANNEL_RESPONSE_V1');
  assert.equal(first.events[0].response.channel, 'instagram');
  assert.equal(first.events[0].outbound_intent.provider, 'meta_instagram');
  assert.equal(first.events[0].outbound_intent.ig_business_user_id, USER_ID);
  assert.equal(first.events[0].outbound_result.success, true);
  assert.equal(first.events[0].outbound_result.recipient_id, '17841470000000001');
  assert.equal(first.events[0].trace.external_message_id, 'm_instagram.synthetic.001');
  assert.match(first.events[0].trace.correlation_id, /^ig:/);

  const duplicateRes = responseCapture();
  await handler(request('POST', signed(fixture('02-duplicate-text.json')).body, signed(fixture('02-duplicate-text.json')).headers), duplicateRes, new URL('https://staging.test/webhook/gate08/instagram'));
  assert.equal(duplicateRes.statusCode, 200);
  assert.equal(JSON.parse(duplicateRes.body).events[0].deduplicated, true);
  assert.equal(replay.size, 1);
  assert.equal(sentOutbounds.length, 1);

  const invalidRes = responseCapture();
  await handler(request('POST', valid.body, { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` }), invalidRes, new URL('https://staging.test/webhook/gate08/instagram'));
  assert.equal(invalidRes.statusCode, 401);

  const unsupported = signed(fixture('03-unsupported-event.json'));
  const unsupportedRes = responseCapture();
  await handler(request('POST', unsupported.body, unsupported.headers), unsupportedRes, new URL('https://staging.test/webhook/gate08/instagram'));
  assert.equal(JSON.parse(unsupportedRes.body).events[0].classified, 'unsupported');

  const malformed = signed(fixture('04-malformed-payload.json'));
  const malformedRes = responseCapture();
  await handler(request('POST', malformed.body, malformed.headers), malformedRes, new URL('https://staging.test/webhook/gate08/instagram'));
  assert.equal(malformedRes.statusCode, 400);

  process.env.INSTAGRAM_META_APP_SECRET = 'wrong-meta-secret';
  const handoff = signed(fixture('06-handoff-text.json'));
  const handoffRes = responseCapture();
  await handler(request('POST', handoff.body, handoff.headers), handoffRes, new URL('https://staging.test/webhook/gate08/instagram'));
  const handoffBody = JSON.parse(handoffRes.body);
  assert.equal(handoffBody.events[0].response.response_type, 'handoff');
  assert.equal(handoffBody.events[0].response.handoff.owner, 'OMEGA_GATE_05');
  assert.equal(handoffWrites.length, 1);

  assert.equal(normalizePayload(fixture('01-valid-text.json'))[0].normalized.channel, 'instagram');
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'integrations', 'n8n', 'whatsapp', 'workflows', 'WF-04-whatsapp-inbound-real.json')), true);
  console.log('instagram staging adapter: PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
