'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { createInstagramIngressHandler } = require('../api/_lib/instagram-social-ingress');
const { createInstagramOutboundSender } = require('../api/_lib/instagram-outbound');
const { createSession, respondToMessage } = require('../core/omega-concierge-core');

const USER_ID = '17841433759878333';
const SENDER_ID = '17841470000000001';
const APP_SECRET = 'synthetic-dispatch-forensics-secret';
const MESSAGE_TEXT = 'Hola, soy enfermero y trabajo en una guardia. ¿Qué capacitaciones tienen?';

function responseCapture() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = String(value || ''); },
  };
}

function request(method, body, headers) {
  return { method, body, headers, async *[Symbol.asyncIterator]() {} };
}

function signedPayload() {
  const payload = {
    object: 'instagram',
    entry: [{
      id: USER_ID,
      time: 1787842800000,
      messaging: [{
        sender: { id: SENDER_ID },
        recipient: { id: USER_ID },
        timestamp: 1787842800000,
        message: { mid: 'm_dispatch.forensics.001', text: MESSAGE_TEXT },
      }],
    }],
  };
  const body = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
  return { body, headers: { 'x-hub-signature-256': `sha256=${signature}` } };
}

async function run() {
  process.env.INSTAGRAM_META_APP_SECRET = APP_SECRET;
  process.env.INSTAGRAM_LOGIN_APP_SECRET = APP_SECRET;
  const logs = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args) => logs.push(String(args[0]));
  console.warn = (...args) => logs.push(String(args[0]));
  console.error = (...args) => logs.push(String(args[0]));
  try {
    const sourceRetriever = async () => ({
      status: 'VERIFIED',
      source_used: true,
      source_url: 'https://campusprofesionalenfermeria.com/',
      source_timestamp: new Date().toISOString(),
      required_fact_found: true,
      evidence: 'Diplomatura en Enfermería Escolar. Diplomatura en Anestesia y Cirugía para Enfermería. Diplomatura en Cuidados Críticos y Emergencias para Enfermería.',
    });
    const longAgentResponse = `${'La oferta oficial incluye Diplomatura en Enfermería Escolar, Diplomatura en Anestesia y Cirugía para Enfermería y Diplomatura en Cuidados Críticos y Emergencias para Enfermería. '.repeat(5)}Para orientarte mejor, podemos revisar tu experiencia y objetivo profesional.`;
    const senderCalls = [];
    const sendOutbound = createInstagramOutboundSender({
      resolveAccessToken: async () => 'synthetic-token-not-logged',
      fetchImpl: async () => { senderCalls.push(true); return { ok: true, status: 200, async json() { return { message_id: 'should-not-be-called' }; } }; },
    });
    const handler = createInstagramIngressHandler({
      replayStore: new Map(),
      sourceRetriever,
      modelProvider: { provider: 'openai', model: 'gpt-5.6-terra', async generate() { return longAgentResponse; } },
      sendOutbound,
      findActiveHandoff: async () => null,
      now: () => 1787842800,
    });
    const signed = signedPayload();
    const res = responseCapture();
    await handler(request('POST', signed.body, signed.headers), res, new URL('https://staging.test/webhook/gate08/instagram'));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const event = body.events[0];
    assert.equal(event.response.response_type, 'text');
    assert.equal(event.response.channel, 'instagram');
    assert.equal(event.response_mode, undefined);
    assert.equal(event.outbound_intent.channel, 'instagram');
    assert.equal(event.outbound_intent.recipient_id, SENDER_ID);
    assert.equal(event.outbound_intent.text.length > 500, true);
    assert.equal(event.outbound_result.success, true);
    assert.equal(event.outbound_result.message_id, 'should-not-be-called');
    assert.equal(event.outbound_result.http_status, 200);
    assert.equal(senderCalls.length, 1);

    const entered = logs.map((item) => { try { return JSON.parse(item); } catch { return null; } }).filter(Boolean);
    const exit = entered.find((item) => item.event === 'instagram_dispatch_exit_reason');
    assert.equal(entered.some((item) => item.event === 'instagram_dispatch_entered' && item.response_text_present === true), true);
    assert.equal(entered.some((item) => item.event === 'instagram_dispatch_should_send' && item.should_send === true), true);
    assert.equal(entered.some((item) => item.event === 'instagram_dispatch_sender_invoked'), true);
    assert.equal(entered.some((item) => item.event === 'instagram_dispatch_credential_resolution' && item.credential_available === true), true);
    assert.equal(exit.reason, 'META_SEND_ACCEPTED');

    const oldResponse = respondToMessage(createSession({ started: true, conversation_id: 'forensics-old-contract' }), MESSAGE_TEXT, { channel: 'instagram' });
    assert.equal(oldResponse.response_type, 'text');
    assert.equal(typeof oldResponse.text, 'string');
    assert.equal(oldResponse.text.length > 500, false);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'api', '_lib', 'instagram-social-ingress.js')), true);
    console.log = originalLog;
    console.log('instagram dispatch forensics replay: PASS');
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
