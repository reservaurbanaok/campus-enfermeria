'use strict';

const crypto = require('crypto');
const { courses } = require('../../core/omega-concierge-core');

const EVENT_SCHEMA_VERSION = 'omega-events-v1';
const TABLE = 'public.omega_commercial_events';
const TIME_ZONE = 'America/Argentina/Buenos_Aires';
const CHANNELS = new Set(['campus_web', 'whatsapp', 'instagram']);
const EVENT_TYPES = new Set([
  'conversation_started', 'identity_provided', 'identity_verified', 'intent_detected',
  'profile_qualified', 'course_viewed', 'course_asked', 'course_recommended',
  'recommendation_accepted', 'recommendation_rejected', 'price_asked',
  'certification_asked', 'modality_asked', 'duration_asked', 'requirement_asked',
  'objection_detected', 'objection_resolved', 'human_requested', 'handoff_created',
  'enrollment_link_sent', 'enrollment_started', 'enrollment_completed', 'welcome_sent',
  'onboarding_started', 'netroom_access_ready', 'netroom_first_login',
  'course_completed', 'next_course_recommended', 'course_context_set',
  'course_list_asked', 'enrollment_intent_detected'
]);
const COURSE_ALIASES = new Map([
  ['escolar', 'escolar'],
  ['anestesia', 'anestesia'],
  ['cuidados', 'cuidados_criticos_emergencias'],
  ['cuidados_criticos_emergencias', 'cuidados_criticos_emergencias']
]);
const SENSITIVE_KEY = /(text|body|message|transcript|token|secret|password|authorization|code|credential|cookie|phone|email|name)/i;

const TABLE_CREATE_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL,
  conversation_id TEXT,
  channel TEXT,
  person_or_anonymous_id TEXT,
  course_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL,
  correlation_id TEXT
);`;
const INDEX_SQL = [
  `CREATE INDEX IF NOT EXISTS omega_commercial_events_timestamp_idx ON ${TABLE} (event_timestamp)`,
  `CREATE INDEX IF NOT EXISTS omega_commercial_events_channel_idx ON ${TABLE} (channel)`,
  `CREATE INDEX IF NOT EXISTS omega_commercial_events_type_idx ON ${TABLE} (event_type)`,
  `CREATE INDEX IF NOT EXISTS omega_commercial_events_course_idx ON ${TABLE} (course_id)`,
];

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function asDb(db) {
  if (!db || typeof db.query !== 'function') throw new Error('database_unconfigured');
  return db;
}

async function ensureEventStore(db) {
  const database = asDb(db);
  await database.query(TABLE_CREATE_SQL, []);
  for (const statement of INDEX_SQL) await database.query(statement, []);
  return { table: TABLE, schema_version: EVENT_SCHEMA_VERSION };
}

function normalizeCourseId(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  return COURSE_ALIASES.get(normalized) || normalized;
}

function sanitizeMetadata(value, eventType) {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') {
    if (eventType === 'course_asked' || eventType === 'course_recommended' || eventType === 'course_context_set' || eventType === 'objection_detected') {
      return { category: value.slice(0, 80) };
    }
    return {};
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeMetadata(item, eventType));
  if (typeof value !== 'object') return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'trigger_code' && SENSITIVE_KEY.test(key)) continue;
    if (['handoff_id', 'external_message_id', 'sender_id', 'recipient_id'].includes(key)) continue;
    if (typeof item === 'string') {
      if (key === 'trigger_code' || key === 'priority' || key === 'status' || key === 'reason' || key === 'category' || key === 'enrollment_status' || key === 'onboarding_status' || key === 'access_status' || key === 'completion_status') result[key] = item.slice(0, 120);
      continue;
    }
    if (typeof item === 'boolean' || typeof item === 'number') result[key] = item;
    else if (item && typeof item === 'object') result[key] = sanitizeMetadata(item, eventType);
  }
  return result;
}

function normalizeEvent(item, context = {}, index = 0) {
  const eventType = String(item?.event_type || item?.event || item?.name || '').trim();
  if (!eventType) throw new Error('event_type_required');
  const timestamp = item?.timestamp || context.timestamp || new Date().toISOString();
  const eventDate = new Date(timestamp);
  if (Number.isNaN(eventDate.getTime())) throw new Error('event_timestamp_invalid');
  const conversationId = context.conversation_id || item?.conversation_id || null;
  const correlationId = context.correlation_id || item?.correlation_id || null;
  const courseDetailTypes = new Set(['course_context_set', 'course_asked', 'course_recommended', 'course_viewed', 'price_asked', 'certification_asked', 'modality_asked', 'duration_asked', 'requirement_asked']);
  const courseDetail = courseDetailTypes.has(eventType) && typeof item?.detail === 'string' ? item.detail : null;
  const courseId = normalizeCourseId(item?.course_id || context.course_id || courseDetail);
  const source = String(context.source || item?.source || 'omega').slice(0, 120);
  const eventId = String(item?.event_id || hash([source, correlationId || '', eventType, eventDate.toISOString(), courseId || '', index].join('|')));
  const anonymousValue = context.person_or_anonymous_id || context.sender_ref || null;
  const anonymousId = anonymousValue ? `sha256:${hash(anonymousValue)}` : null;
  return {
    event_id: eventId,
    event_type: eventType,
    schema_version: String(item?.schema_version || EVENT_SCHEMA_VERSION),
    event_timestamp: eventDate.toISOString(),
    conversation_id: conversationId ? String(conversationId).slice(0, 200) : null,
    channel: context.channel || item?.channel || null,
    person_or_anonymous_id: anonymousId ? String(anonymousId).slice(0, 200) : null,
    course_id: courseId,
    metadata_json: sanitizeMetadata(item?.metadata_json || item?.detail, eventType),
    source,
    correlation_id: correlationId ? `sha256:${hash(correlationId)}` : null,
  };
}

async function appendEvents(db, items, context = {}) {
  const database = asDb(db);
  const normalized = (Array.isArray(items) ? items : [items]).map((item, index) => normalizeEvent(item, context, index));
  if (!normalized.length) return { inserted: 0, event_ids: [] };
  await ensureEventStore(database);
  let inserted = 0;
  for (const event of normalized) {
    const result = await database.query(
      `INSERT INTO ${TABLE} (event_id,event_type,schema_version,event_timestamp,conversation_id,channel,person_or_anonymous_id,course_id,metadata_json,source,correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.event_id, event.event_type, event.schema_version, event.event_timestamp, event.conversation_id, event.channel, event.person_or_anonymous_id, event.course_id, JSON.stringify(event.metadata_json), event.source, event.correlation_id],
    );
    if (result && Array.isArray(result.rows) && result.rows.length) inserted += 1;
  }
  return { inserted, event_ids: normalized.map((event) => event.event_id) };
}

function captureCanonicalEvents(items, context = {}) {
  if ((context.enabled !== true && process.env.OMEGA_COMMERCIAL_EVENT_STORE_ENABLED !== 'true') || !process.env.DATABASE_URL) return;
  Promise.resolve().then(async () => {
    const { getDatabase } = require('./db');
    await appendEvents(getDatabase(), items, context);
  }).catch((error) => {
    console.warn(JSON.stringify({ event: 'commercial_event_capture_failed', code: error?.code || error?.message || 'storage_unavailable' }));
  });
}

function formatLocalDate(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function zonedMidnight(dateText) {
  const guess = new Date(`${dateText}T00:00:00.000Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess);
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour), Number(value.minute), Number(value.second));
  return new Date(guess.getTime() - (represented - guess.getTime()));
}

function shiftDate(dateText, days) {
  const value = new Date(`${dateText}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function normalizeFilters(input = {}, now = new Date()) {
  const window = String(input.window || input.time_window || 'LAST_7_DAYS').toUpperCase();
  const today = formatLocalDate(now);
  let fromDate;
  let toDate;
  if (window === 'TODAY') { fromDate = today; toDate = shiftDate(today, 1); }
  else if (window === 'LAST_30_DAYS') { fromDate = shiftDate(today, -29); toDate = shiftDate(today, 1); }
  else if (window === 'CUSTOM_DATE_RANGE') { fromDate = String(input.from || '').slice(0, 10); toDate = shiftDate(String(input.to || fromDate).slice(0, 10), 1); }
  else { fromDate = shiftDate(today, -6); toDate = shiftDate(today, 1); }
  const from = zonedMidnight(fromDate);
  const to = zonedMidnight(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new Error('invalid_date_range');
  return { window, from: from.toISOString(), to: to.toISOString(), channel: input.channel ? String(input.channel) : null, course_id: input.course_id ? normalizeCourseId(input.course_id) : null, timezone: TIME_ZONE };
}

async function readEvents(db, filters) {
  const database = asDb(db);
  await ensureEventStore(database);
  const result = await database.query(
    `SELECT event_id,event_type,schema_version,event_timestamp,conversation_id,channel,person_or_anonymous_id,course_id,metadata_json,source,correlation_id
     FROM ${TABLE} WHERE event_timestamp >= $1 AND event_timestamp < $2
     AND ($3::text IS NULL OR channel = $3) AND ($4::text IS NULL OR course_id = $4)
     ORDER BY event_timestamp ASC LIMIT 10000`,
    [filters.from, filters.to, filters.channel, filters.course_id],
  );
  return result.rows || [];
}

function metric(value, available = true, denominator = null) {
  if (!available) return { value: null, status: 'NO_DATA', denominator };
  return { value, status: value === 0 ? 'ZERO' : 'MEASURED', denominator };
}

function distinct(rows, field, eventType) {
  return new Set(rows.filter((row) => !eventType || row.event_type === eventType).map((row) => row[field]).filter(Boolean)).size;
}

function countType(rows, eventType) { return rows.filter((row) => row.event_type === eventType).length; }

function isTestEvent(row) { return row?.metadata_json && row.metadata_json.test_event === true; }

function courseLabel(id) { return courses.find((course) => course.key === id || course.slug === id)?.name || id; }

function ranked(rows, eventType, field = 'course_id') {
  const counts = new Map();
  rows.filter((row) => row.event_type === eventType).forEach((row) => {
    const value = row[field] || (row.metadata_json && (row.metadata_json.category || row.metadata_json.trigger_code));
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: field === 'course_id' ? courseLabel(value) : value, count }));
}

function evaluateDataQuality(rows) {
  const duplicateIds = rows.length - new Set(rows.map((row) => row.event_id).filter(Boolean)).size;
  const requiredNulls = rows.filter((row) => !row.event_id || !row.event_type || !row.schema_version || !row.event_timestamp || !row.source).length;
  const unknownTypes = rows.filter((row) => !EVENT_TYPES.has(row.event_type)).length;
  const invalidChannels = rows.filter((row) => row.channel && !CHANNELS.has(row.channel)).length;
  const invalidSchemas = rows.filter((row) => row.schema_version !== EVENT_SCHEMA_VERSION).length;
  const missingTimestamps = rows.filter((row) => !row.event_timestamp || Number.isNaN(new Date(row.event_timestamp).getTime())).length;
  const courseRelevant = rows.filter((row) => ['course_asked', 'course_recommended', 'course_viewed', 'price_asked', 'certification_asked', 'modality_asked', 'duration_asked', 'requirement_asked'].includes(row.event_type));
  const conversationRelevant = rows.filter((row) => row.event_type === 'conversation_started' || row.event_type === 'intent_detected');
  const issues = duplicateIds + requiredNulls + unknownTypes + invalidChannels + invalidSchemas + missingTimestamps;
  return {
    status: issues === 0 ? 'PASS' : 'FAIL', event_count: rows.length, duplicate_event_ids: duplicateIds,
    required_nulls: requiredNulls, unknown_event_types: unknownTypes, invalid_channels: invalidChannels,
    invalid_schema_versions: invalidSchemas, missing_timestamps: missingTimestamps,
    course_id_coverage: courseRelevant.length ? courseRelevant.filter((row) => row.course_id).length / courseRelevant.length : null,
    conversation_id_coverage: conversationRelevant.length ? conversationRelevant.filter((row) => row.conversation_id).length / conversationRelevant.length : null,
    empty_state: rows.length === 0,
  };
}

function buildCoverage(rows) {
  const eventTypes = [...new Set(rows.map((row) => row.event_type).filter(Boolean))].sort();
  const channels = [...new Set(rows.map((row) => row.channel).filter(Boolean))].sort();
  const courseIds = [...new Set(rows.map((row) => row.course_id).filter(Boolean))].sort();
  const funnelTypes = ['conversation_started', 'course_recommended', 'enrollment_link_sent', 'enrollment_started', 'enrollment_completed'];
  let status = 'NO_DATA';
  if (rows.length) status = funnelTypes.every((eventType) => eventTypes.includes(eventType)) ? 'SUFFICIENT_FOR_FUNNEL_ANALYSIS' : (eventTypes.some((eventType) => ['conversation_started', 'intent_detected', 'profile_qualified', 'course_asked', 'course_recommended', 'price_asked', 'certification_asked', 'modality_asked', 'duration_asked', 'requirement_asked', 'objection_detected', 'handoff_created'].includes(eventType)) ? 'SUFFICIENT_FOR_BASIC_SIGNAL' : 'PARTIAL');
  return {
    status,
    event_types_seen: eventTypes,
    channels_seen: channels,
    courses_seen: courseIds.map((courseId) => ({ course_id: courseId, name: courseLabel(courseId) })),
    business_event_count: rows.length,
  };
}

function buildMetrics(rows, filters) {
  const conversationCount = distinct(rows, 'conversation_id');
  const started = distinct(rows, 'conversation_id', 'conversation_started');
  const intentCount = distinct(rows, 'conversation_id', 'intent_detected');
  const recommendations = countType(rows, 'course_recommended');
  const accepted = countType(rows, 'recommendation_accepted');
  const objections = countType(rows, 'objection_detected');
  const resolvedObjections = countType(rows, 'objection_resolved');
  const dataQuality = evaluateDataQuality(rows);
  const covered = (type) => rows.some((row) => row.event_type === type);
  const funnelTypes = ['conversation_started', 'course_recommended', 'enrollment_link_sent', 'enrollment_started', 'enrollment_completed'];
  return {
    filters,
    coverage: buildCoverage(rows),
    data_quality: dataQuality,
    acquisition: {
      conversations_total: metric(conversationCount, conversationCount > 0 || rows.length > 0),
      conversations_by_channel: [...new Set(rows.map((row) => row.channel).filter(Boolean))].map((channel) => ({ channel, conversations: distinct(rows.filter((row) => row.channel === channel), 'conversation_id') })),
      unique_conversations_per_day: metric(new Set(rows.filter((row) => row.conversation_id).map((row) => `${String(row.event_timestamp).slice(0, 10)}|${row.conversation_id}`)).size, rows.length > 0),
      course_asked_by_course: ranked(rows, 'course_asked'),
    },
    intent: {
      intent_detected: metric(countType(rows, 'intent_detected'), covered('intent_detected')),
      intent_rate: started > 0 ? { value: intentCount / started, status: 'MEASURED', numerator: intentCount, denominator: started } : { value: null, status: 'NO_DATA', numerator: intentCount, denominator: null },
      profile_qualified: metric(countType(rows, 'profile_qualified'), covered('profile_qualified')),
      high_intent_signals: ['enrollment_intent_detected', 'recommendation_accepted', 'enrollment_started'].map((eventType) => ({ event_type: eventType, ...metric(countType(rows, eventType), covered(eventType)) })),
    },
    commercial_interest: ['price_asked', 'certification_asked', 'modality_asked', 'duration_asked', 'requirement_asked'].map((eventType) => ({ event_type: eventType, ...metric(countType(rows, eventType), covered(eventType)) })),
    recommendations: {
      recommended: metric(recommendations, covered('course_recommended')),
      accepted: metric(accepted, covered('recommendation_accepted')),
      acceptance_rate: recommendations > 0 ? { value: accepted / recommendations, status: 'MEASURED', numerator: accepted, denominator: recommendations } : { value: null, status: 'NO_DATA', numerator: accepted, denominator: null },
      by_course: ranked(rows, 'course_recommended'),
    },
    objections: {
      detected: metric(objections, covered('objection_detected')),
      resolved: metric(resolvedObjections, covered('objection_resolved')),
      resolution_rate: objections > 0 ? { value: resolvedObjections / objections, status: 'MEASURED', numerator: resolvedObjections, denominator: objections } : { value: null, status: 'NO_DATA', numerator: resolvedObjections, denominator: null },
      ranking: ranked(rows, 'objection_detected', 'category'),
    },
    handoffs: metric(countType(rows, 'handoff_created'), covered('handoff_created')),
    funnel: funnelTypes.map((eventType, index) => ({ event_type: eventType, ...metric(distinct(rows, 'conversation_id', eventType), covered(eventType)), coverage: covered(eventType) ? 'MEASURED' : 'NOT_INSTRUMENTED_OR_NO_DATA', previous_event_type: index ? funnelTypes[index - 1] : null })),
  };
}

function buildSensor(metrics, rows) {
  const facts = [];
  if (metrics.acquisition.conversations_total.status !== 'NO_DATA') facts.push({ key: 'conversations_total', value: metrics.acquisition.conversations_total.value, evidence: 'conversation_id' });
  if (metrics.recommendations.by_course.length) facts.push({ key: 'top_recommended_course', value: metrics.recommendations.by_course[0], evidence: 'course_recommended' });
  if (metrics.objections.ranking.length) facts.push({ key: 'top_objection', value: metrics.objections.ranking[0], evidence: 'objection_detected' });
  const recommendations = metrics.recommendations.by_course[0];
  const interpretations = [];
  if (metrics.intent.intent_rate.status === 'MEASURED') interpretations.push({ key: 'intent_rate', value: metrics.intent.intent_rate.value, basis: 'intent_detected / conversation_started' });
  if (metrics.funnel.some((step) => step.status === 'NO_DATA')) interpretations.push({ key: 'funnel_coverage_gap', value: 'INSUFFICIENT_DATA', basis: 'required funnel event type unavailable in selected range' });
  const recommendationsOut = [];
  if (recommendations) recommendationsOut.push({ key: 'focus_top_course', action: `Revisar cobertura comercial de ${recommendations.label}`, evidence: recommendations });
  if (!rows.length) recommendationsOut.push({ key: 'instrumentation', action: 'Mantener captura habilitada y volver a medir con datos reales de STAGING', evidence: 'INSUFFICIENT_DATA' });
  return { status: rows.length ? 'MEASURED' : 'INSUFFICIENT_DATA', facts, interpretations, recommendations: recommendationsOut };
}

async function getCommercialIntelligence(db, input = {}) {
  const filters = normalizeFilters(input);
  const rows = await readEvents(db, filters);
  const businessRows = rows.filter((row) => !isTestEvent(row));
  const metrics = buildMetrics(businessRows, filters);
  metrics.data_quality.event_count = rows.length;
  metrics.data_quality.test_event_count = rows.filter(isTestEvent).length;
  metrics.data_quality.business_event_count = businessRows.length;
  const sensor = buildSensor(metrics, businessRows);
  return { schema_version: 'omega-commercial-intelligence-v1', generated_at: new Date().toISOString(), timezone: TIME_ZONE, coverage: metrics.coverage, metrics, sensor };
}

module.exports = {
  EVENT_SCHEMA_VERSION, TABLE, TIME_ZONE, EVENT_TYPES, ensureEventStore, normalizeEvent, appendEvents,
  captureCanonicalEvents, normalizeFilters, readEvents, evaluateDataQuality, buildMetrics, buildSensor,
  getCommercialIntelligence, sanitizeMetadata, normalizeCourseId, isTestEvent, buildCoverage,
};
