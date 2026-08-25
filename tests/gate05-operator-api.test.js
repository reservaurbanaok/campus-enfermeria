const assert = require('node:assert/strict');
const { test } = require('node:test');
const { operatorSessionCookie } = require('../api/_lib/auth');
const { getDatabase, persistence } = require('../api/_lib/handoffs');
const listApi = require('../api/handoffs');
const getApi = require('../api/handoffs/[handoff_id]');
const claimApi = require('../api/handoffs/[handoff_id]/claim');
const resolveApi = require('../api/handoffs/[handoff_id]/resolve');

process.env.HANDOFF_OPERATOR_ID = 'omega-staging-test-operator';
process.env.HANDOFF_OPERATOR_ROLE = 'OPERATOR';
process.env.HANDOFF_OPERATOR_SESSION_SECRET = 'local-test-session-secret';

function response() {
  return { statusCode: 200, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value; }, end(value = '') { this.body = value; } };
}
function request(method, handoffId, body, cookie) {
  return { method, query: handoffId ? { handoff_id: handoffId } : {}, headers: cookie ? { cookie } : {}, async *[Symbol.asyncIterator]() { if (body !== undefined) yield JSON.stringify(body); } };
}
async function call(handler, req) { const res = response(); await handler(req, res); return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }; }

test('authenticated operator APIs preserve lifecycle and privacy', async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for staging QA');
  const db = getDatabase();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const firstId = `qa-api-ai-${suffix}`;
  const secondId = `qa-api-close-${suffix}`;
  const cookie = operatorSessionCookie();
  const context = { handoff_id: firstId, conversation_id: `qa-conversation-${suffix}`, channel: 'web', intent: 'enrollment', handoff_reason: 'USER_REQUESTED_HUMAN', questions: [{ question: 'price?', answer: 'synthetic' }], raw_transcript: 'MUST_NOT_APPEAR', NETROOM_PRIVATE: { lesson: 'MUST_NOT_APPEAR' } };
  try {
    await persistence.createHandoff(db, context);
    await persistence.createHandoff(db, { ...context, handoff_id: secondId, conversation_id: `${context.conversation_id}-close` });

    assert.equal((await call(listApi, request('GET', null, undefined, ''))).status, 401);
    assert.equal((await call(listApi, request('GET', null, undefined, 'campus_dashboard_session=generic'))).status, 401);
    const listed = await call(listApi, request('GET', null, undefined, cookie));
    assert.equal(listed.status, 200);
    assert.equal(listed.json.handoffs.filter((item) => item.handoff_id === firstId || item.handoff_id === secondId).length, 2);
    assert.equal(JSON.stringify(listed.json).includes('MUST_NOT_APPEAR'), false);

    const fetched = await call(getApi, request('GET', firstId, undefined, cookie));
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.handoff.handoff_id, firstId);
    assert.equal(fetched.json.handoff.handoff_context.raw_transcript, undefined);
    assert.equal(fetched.json.handoff.handoff_context.NETROOM_PRIVATE, undefined);

    const claimed = await call(claimApi, request('POST', firstId, undefined, cookie));
    assert.equal(claimed.status, 200);
    assert.equal(claimed.json.handoff.status, 'HUMAN_ACTIVE');
    assert.equal(claimed.json.handoff.claimed_by, process.env.HANDOFF_OPERATOR_ID);
    assert.equal((await call(claimApi, request('POST', firstId, undefined, cookie))).status, 409);

    const aiResolution = { resolution_summary: 'synthetic AI return', human_actions_taken: [], resolved_items: [], remaining_items: ['synthetic follow-up'], next_owner: 'AI', ai_resume_context: { next: 'continue' } };
    const returned = await call(resolveApi, request('POST', firstId, aiResolution, cookie));
    assert.equal(returned.status, 200);
    assert.equal(returned.json.handoff.status, 'RETURNED_TO_AI');
    assert.equal(returned.json.handoff.resolution.resolved_by, process.env.HANDOFF_OPERATOR_ID);
    assert.equal((await call(resolveApi, request('POST', firstId, aiResolution, cookie))).status, 409);

    await call(claimApi, request('POST', secondId, undefined, cookie));
    const closed = await call(resolveApi, request('POST', secondId, { ...aiResolution, next_owner: 'CLOSE' }, cookie));
    assert.equal(closed.status, 200);
    assert.equal(closed.json.handoff.status, 'CLOSED');
  } finally {
    await db.query('DELETE FROM public.omega_handoffs WHERE handoff_id IN ($1, $2)', [firstId, secondId]);
  }
});
