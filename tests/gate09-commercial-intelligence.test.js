'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EVENT_SCHEMA_VERSION, TABLE, appendEvents, buildMetrics, buildSensor,
  evaluateDataQuality, getCommercialIntelligence, normalizeEvent, normalizeFilters, sanitizeMetadata,
  buildCoverage,
} = require('../api/_lib/commercial-event-store');
const { createCommercialIntelligenceHandler } = require('../api/dashboard/commercial-intelligence');

class FakeDatabase {
  constructor(rows = []) { this.rows = rows.slice(); this.queries = []; }
  async query(sql, params) {
    this.queries.push({ sql, params });
    if (sql.includes('INSERT INTO')) {
      if (this.rows.some((row) => row.event_id === params[0])) return { rows: [] };
      this.rows.push({ event_id: params[0], event_type: params[1], schema_version: params[2], event_timestamp: params[3], conversation_id: params[4], channel: params[5], person_or_anonymous_id: params[6], course_id: params[7], metadata_json: JSON.parse(params[8]), source: params[9], correlation_id: params[10] });
      return { rows: [{ event_id: params[0] }] };
    }
    if (sql.includes('SELECT event_id')) return { rows: this.rows.slice() };
    return { rows: [] };
  }
}

function response() {
  return { statusCode: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = String(value || ''); } };
}

test('normaliza eventos al schema canónico sin almacenar mensajes ni identificadores directos', () => {
  const event = normalizeEvent({ name: 'intent_detected', detail: 'Hola, necesito información' }, { channel: 'instagram', conversation_id: 'instagram-anon', correlation_id: 'ig:correlation', person_or_anonymous_id: 'sha256:sender', source: 'test' });
  assert.equal(event.schema_version, EVENT_SCHEMA_VERSION);
  assert.equal(event.metadata_json && Object.keys(event.metadata_json).length, 0);
  assert.equal(JSON.stringify(event).includes('Hola'), false);
  assert.equal(JSON.stringify(event).includes('sender'), false);
  assert.equal(JSON.stringify(event).includes('access_token'), false);
  assert.equal(event.course_id, null);
});

test('sanitiza detalles sensibles y conserva sólo categorías comerciales', () => {
  const safe = sanitizeMetadata({ trigger_code: 'USER_REQUESTED_HUMAN', text: 'no guardar', access_token: 'no guardar', category: 'OBJECTION_PRICE' }, 'objection_detected');
  assert.deepEqual(safe, { trigger_code: 'USER_REQUESTED_HUMAN', category: 'OBJECTION_PRICE' });
});

test('Event Store crea estructura y es idempotente por event_id', async () => {
  const db = new FakeDatabase();
  const item = { event: 'course_asked', detail: 'cuidados', timestamp: '2026-08-28T20:00:00.000Z' };
  const context = { channel: 'instagram', conversation_id: 'instagram-anon', correlation_id: 'corr-1', source: 'test' };
  const first = await appendEvents(db, [item], context);
  const second = await appendEvents(db, [item], context);
  assert.equal(first.inserted, 1);
  assert.equal(second.inserted, 0);
  assert.equal(db.rows.length, 1);
  assert.equal(db.queries.some((query) => query.sql.includes(`CREATE TABLE IF NOT EXISTS ${TABLE}`)), true);
  assert.equal(db.rows[0].course_id, 'cuidados_criticos_emergencias');
});

test('métricas distinguen datos medidos, ZERO y NO_DATA con denominadores explícitos', () => {
  const rows = [
    { event_id: '1', event_type: 'conversation_started', schema_version: EVENT_SCHEMA_VERSION, event_timestamp: '2026-08-28T20:00:00.000Z', conversation_id: 'c1', channel: 'instagram', course_id: null, metadata_json: {} },
    { event_id: '2', event_type: 'intent_detected', schema_version: EVENT_SCHEMA_VERSION, event_timestamp: '2026-08-28T20:00:01.000Z', conversation_id: 'c1', channel: 'instagram', course_id: null, metadata_json: {} },
    { event_id: '3', event_type: 'course_asked', schema_version: EVENT_SCHEMA_VERSION, event_timestamp: '2026-08-28T20:00:02.000Z', conversation_id: 'c1', channel: 'instagram', course_id: 'cuidados_criticos_emergencias', metadata_json: {} },
  ];
  const metrics = buildMetrics(rows, { window: 'CUSTOM_DATE_RANGE', timezone: 'America/Argentina/Buenos_Aires' });
  assert.equal(metrics.acquisition.conversations_total.value, 1);
  assert.equal(metrics.intent.intent_rate.value, 1);
  assert.equal(metrics.intent.intent_rate.numerator, 1);
  assert.equal(metrics.intent.intent_rate.denominator, 1);
  assert.equal(metrics.recommendations.acceptance_rate.status, 'NO_DATA');
  assert.equal(metrics.recommendations.recommended.status, 'NO_DATA');
  assert.equal(metrics.acquisition.course_asked_by_course[0].value, 'cuidados_criticos_emergencias');
  assert.equal(buildSensor(metrics, rows).status, 'MEASURED');
  assert.deepEqual(metrics.coverage.event_types_seen, ['conversation_started', 'course_asked', 'intent_detected']);
  assert.deepEqual(metrics.coverage.channels_seen, ['instagram']);
  assert.equal(metrics.coverage.courses_seen[0].course_id, 'cuidados_criticos_emergencias');
  assert.equal(metrics.coverage.status, 'SUFFICIENT_FOR_BASIC_SIGNAL');
});

test('calidad de datos reporta PASS en estado vacío y no lo presenta como cero comercial', () => {
  const quality = evaluateDataQuality([]);
  const metrics = buildMetrics([], { window: 'LAST_7_DAYS' });
  assert.equal(quality.status, 'PASS');
  assert.equal(quality.empty_state, true);
  assert.equal(metrics.acquisition.conversations_total.status, 'NO_DATA');
  assert.equal(metrics.intent.intent_rate.status, 'NO_DATA');
  assert.equal(buildSensor(metrics, []).status, 'INSUFFICIENT_DATA');
  assert.equal(buildCoverage([]).status, 'NO_DATA');
});

test('filtros aceptan ventanas y rango custom en timezone operativo', () => {
  const custom = normalizeFilters({ window: 'CUSTOM_DATE_RANGE', from: '2026-08-01', to: '2026-08-03', channel: 'instagram' }, new Date('2026-08-28T15:00:00.000Z'));
  assert.equal(custom.timezone, 'America/Argentina/Buenos_Aires');
  assert.equal(custom.channel, 'instagram');
  assert.equal(custom.from, '2026-08-01T03:00:00.000Z');
  assert.equal(custom.to, '2026-08-04T03:00:00.000Z');
});

test('API de inteligencia es GET-only y no expone filas ni muta fuera del Event Store', async () => {
  const db = new FakeDatabase();
  const handler = createCommercialIntelligenceHandler({ database: () => db, authorize: () => true });
  const denied = response();
  await handler({ method: 'POST', url: '/' }, denied);
  assert.equal(denied.statusCode, 405);
  const ok = response();
  await handler({ method: 'GET', url: '/?window=LAST_7_DAYS' }, ok);
  assert.equal(ok.statusCode, 200);
  const body = JSON.parse(ok.body);
  assert.equal(body.metrics.data_quality.empty_state, true);
  assert.equal(body.rows, undefined);
  assert.equal(db.queries.filter((query) => query.sql.includes('INSERT INTO')).length, 0);
});

test('un evento aislado test_event=true se almacena, se consulta y queda fuera de KPIs/Sensor', async () => {
  const db = new FakeDatabase();
  await appendEvents(db, [{ event: 'intent_detected', metadata_json: { test_event: true, namespace: 'gate09-plumbing' }, timestamp: '2026-08-28T20:00:00.000Z' }], { channel: 'instagram', conversation_id: 'gate09-test-conversation', correlation_id: 'gate09-test-correlation', source: 'gate09-isolated-test' });
  const report = await getCommercialIntelligence(db, { window: 'CUSTOM_DATE_RANGE', from: '2026-08-28', to: '2026-08-28' });
  assert.equal(db.rows.length, 1);
  assert.equal(report.metrics.data_quality.event_count, 1);
  assert.equal(report.metrics.data_quality.test_event_count, 1);
  assert.equal(report.metrics.data_quality.business_event_count, 0);
  assert.equal(report.metrics.acquisition.conversations_total.status, 'NO_DATA');
  assert.equal(report.sensor.status, 'INSUFFICIENT_DATA');
});
