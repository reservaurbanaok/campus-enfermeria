const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createSession, respondToMessage } = require('../core/omega-concierge-core');
const { createIngressHandler } = require('../api/_lib/channel-ingress');

const SECRET = 'unit-test-only-campus-channel-secret';
const NOW = 1700000000;

function signed(payload, nonce = crypto.randomUUID(), timestamp = String(NOW), secret = SECRET) {
  const body = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n`).update(body).digest('hex');
  return { body, headers: { 'x-omega-service': 'n8n-whatsapp-staging', 'x-omega-timestamp': timestamp, 'x-omega-nonce': nonce, 'x-omega-signature': signature, 'x-omega-idempotency-key': payload.external_message_id } };
}

function response() {
  return { statusCode: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ''; } };
}

function payload(id, text) {
  return { schema_version: 'OMEGA_CHANNEL_MESSAGE_V1', channel: 'whatsapp', external_message_id: id, external_actor_id: '5491100000000', message_type: 'text', text, received_at: '2026-08-27T12:00:00.000Z', correlation_id: `correlation-${id}`, channel_metadata: { provider: 'meta_cloud_api', phone_number_id: 'synthetic' } };
}

async function call(handler, request) {
  const res = response();
  await handler({ method: 'POST', headers: request.headers, body: request.body }, res);
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

process.env.OMEGA_CHANNEL_INGRESS_SECRET = SECRET;
process.env.OMEGA_CHANNEL_ALLOWED_SERVICE = 'n8n-whatsapp-staging';

const replayStore = new Map();
let persisted = null;
const handler = createIngressHandler({ now: () => NOW, replayStore, persistHandoff: async (context) => { persisted = context; return { status: 'WAITING_HUMAN' }; } });

(async () => {
const valid = signed(payload('wamid-valid-1', 'qué cursos'));
const first = await call(handler, valid);
assert.equal(first.status, 200);
assert.equal(first.json.schema_version, 'OMEGA_CHANNEL_RESPONSE_V1');
assert.equal(first.json.response.type, 'text');
assert.match(first.json.response.text, /oferta publicada/);
assert(first.json.events.some((item) => item.event === 'course_list_asked'));

const duplicate = await call(handler, signed(payload('wamid-valid-1', 'qué cursos'), 'nonce-duplicate'));
assert.equal(duplicate.status, 200);
assert.equal(duplicate.json.deduplicated, true);
assert.equal(duplicate.json.response.text, first.json.response.text);

const invalid = signed(payload('wamid-invalid-signature', 'hola'));
invalid.headers['x-omega-signature'] = '0'.repeat(64);
assert.equal((await call(handler, invalid)).status, 401);

assert.equal((await call(handler, signed(payload('wamid-expired', 'hola'), 'nonce-expired', String(NOW - 301)))).status, 401);

const malformedPayload = payload('wamid-malformed', 'hola');
delete malformedPayload.text;
assert.equal((await call(handler, signed(malformedPayload, 'nonce-malformed'))).status, 400);

const handoff = await call(handler, signed(payload('wamid-handoff', 'Quiero hablar con una persona'), 'nonce-handoff'));
assert.equal(handoff.status, 200);
assert.equal(handoff.json.response_type, 'handoff');
assert.equal(handoff.json.handoff.owner, 'OMEGA_GATE_05');
assert.equal(handoff.json.handoff_state, 'requested');
assert.equal(persisted.channel, 'whatsapp');
assert(persisted.excluded_data_domains.includes('NETROOM_PRIVATE'));
assert.equal(Object.hasOwn(persisted, 'raw_transcript'), false);

const coreSession = createSession({ conversation_id: 'campus-test', started: true });
const coreReply = respondToMessage(coreSession, 'Me parece caro');
assert.equal(coreReply.response_type, 'text');
assert(coreReply.events.some((item) => item.name === 'objection_detected'));
assert.equal(respondToMessage(coreSession, 'Necesito un convenio corporativo para mi empresa').response_type, 'handoff');

console.log('Gate 07 shared Core and Campus ingress contract: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
