'use strict';

const assert = require('assert');
const { createInstagramOutboundSender } = require('../api/_lib/instagram-outbound');

const USER_ID = '17841433759878333';
const RECIPIENT_ID = '17841470000000001';
const TOKEN = 'synthetic-instagram-access-token';

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    async json() { return body; },
  };
}

function intent(overrides = {}) {
  return {
    provider: 'meta_instagram',
    channel: 'instagram',
    operation: 'send_text',
    ig_business_user_id: USER_ID,
    recipient_id: RECIPIENT_ID,
    text: 'Respuesta de prueba',
    correlation_id: 'ig:correlation.synthetic',
    ...overrides,
  };
}

async function run() {
  let captured;
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (line) => logs.push(String(line));
  console.error = (line) => errors.push(String(line));
  try {
    const sender = createInstagramOutboundSender({
      resolveAccessToken: async () => TOKEN,
      now: (() => { let value = 1000; return () => (value += 7); })(),
      fetchImpl: async (url, init) => {
        captured = { url: String(url), init };
        return response(200, { recipient_id: RECIPIENT_ID, message_id: 'mid.synthetic.001' }, { 'x-fb-request-id': 'fb.synthetic.001', 'x-fb-trace-id': 'trace.synthetic.001' });
      },
    });
    const result = await sender(intent());
    assert.equal(new URL(captured.url).origin, 'https://graph.instagram.com');
    assert.equal(new URL(captured.url).pathname, `/v25.0/${USER_ID}/messages`);
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(captured.init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(captured.init.body), { recipient: { id: RECIPIENT_ID }, message: { text: 'Respuesta de prueba' } });
    assert.equal(result.success, true);
    assert.equal(result.recipient_id, RECIPIENT_ID);
    assert.equal(result.message_id, 'mid.synthetic.001');
    assert.equal(result.http_status, 200);
    assert.equal(result.meta_request_id, 'fb.synthetic.001');
    assert.equal(result.meta_trace_id, 'trace.synthetic.001');
    assert.equal(result.correlation_id, 'ig:correlation.synthetic');
    assert.equal(logs.some((line) => line.includes(TOKEN)), false);
    assert.equal(errors.some((line) => line.includes(TOKEN)), false);

    const failingSender = createInstagramOutboundSender({
      resolveAccessToken: async () => TOKEN,
      fetchImpl: async () => response(400, { error: { code: 100, error_subcode: 42, type: 'OAuthException', message: 'invalid recipient' } }, { 'x-fb-request-id': 'fb.synthetic.002' }),
    });
    await assert.rejects(() => failingSender(intent()), (error) => {
      assert.equal(error.message, 'instagram_send_failed');
      assert.equal(error.outbound.success, false);
      assert.equal(error.outbound.http_status, 400);
      assert.equal(error.outbound.meta_error_code, '100');
      assert.equal(error.outbound.meta_error_subcode, '42');
      assert.equal(error.outbound.meta_error_type, 'OAuthException');
      assert.equal(error.outbound.error_message, 'invalid recipient');
      assert.equal(JSON.stringify(error.outbound).includes(TOKEN), false);
      return true;
    });

    const timeoutSender = createInstagramOutboundSender({
      resolveAccessToken: async () => TOKEN,
      timeoutMs: 5,
      fetchImpl: async (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    });
    await assert.rejects(() => timeoutSender(intent()), (error) => {
      assert.equal(error.message, 'instagram_send_timeout');
      assert.equal(error.outbound.meta_error_type, 'timeout');
      return true;
    });

    await assert.rejects(() => sender(intent({ recipient_id: USER_ID })), /invalid_instagram_recipient_id/);
    await assert.rejects(() => sender(intent({ recipient_id: 'campus.enfermeria' })), /invalid_instagram_recipient_id/);
    console.log('instagram outbound sender: PASS');
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
