'use strict';

const PRIMARY_SOURCE_URL = 'https://campusprofesionalenfermeria.com/';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const COURSE_MARKERS = [
  'diplomatura en enfermeria escolar',
  'diplomatura en anestesia y cirugia para enfermeria',
  'diplomatura en cuidados criticos y emergencias para enfermeria',
  'curso experto en gestion de alta performance en enfermeria',
  'capacitacion en diabetes para enfermeria',
  'curso dolor en pediatria',
  'ingenieria de factores humanos para guardias seguras y sin errores',
];

function stripMarkup(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function courseAliases(course) {
  const value = normalized(course);
  if (value.includes('cuidad') || value.includes('crit') || value.includes('emerg')) return ['cuidados criticos', 'cuidados críticos', 'emergencias'];
  if (value.includes('anestes') || value.includes('cirug')) return ['anestesia', 'cirugía', 'cirugia'];
  if (value.includes('escolar')) return ['enfermería escolar', 'enfermeria escolar'];
  if (value) return [String(course)];
  return [];
}

function factPatterns(intent) {
  const value = String(intent || '').toUpperCase();
  if (value === 'PRICE' || value === 'OBJECTION') return /\$\s?[0-9][0-9.,]*/i;
  if (value === 'DURATION') return /duraci[oó]n total?\s*:?\s*[^.;|]{1,40}/i;
  if (value === 'MODALITY') return /modalidad\s*:?\s*[^.;|]{1,60}/i;
  if (value === 'CERTIFICATION') return /certificaci[oó]n[\s\S]{0,180}/i;
  if (value === 'ENROLLMENT_INTENT') return /inscrib|formulario oficial/i;
  return null;
}

function extractEvidence(sourceText, course, intent) {
  const text = String(sourceText || '');
  const lower = normalized(text);
  const aliases = courseAliases(course).map(normalized);
  // Course cards appear before their detailed sections; use the final title
  // occurrence so a fact is taken from the detailed block, not another card.
  const courseIndex = aliases.map((alias) => lower.lastIndexOf(alias)).find((index) => index >= 0);
  const pattern = factPatterns(intent);
  if (!pattern) return { found: Boolean(courseIndex >= 0), evidence: courseIndex >= 0 ? text.slice(courseIndex, courseIndex + 8000) : '' };
  const start = courseIndex >= 0 ? Math.max(0, courseIndex - 50) : 0;
  // The Campus page contains summary cards before each full course block.
  // Stop at the next course marker so facts cannot bleed between courses.
  const normalizedText = normalized(text);
  const nextBoundary = COURSE_MARKERS.map((marker) => normalizedText.indexOf(marker, start + 200)).filter((index) => index > start).sort((a, b) => a - b)[0];
  const window = text.slice(start, Math.min(start + 16000, nextBoundary || start + 16000));
  const match = window.match(pattern);
  return { found: Boolean(match), evidence: match ? window.slice(Math.max(0, match.index - 120), match.index + match[0].length + 220) : '' };
}

function createOfficialSourceRetriever(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sourceUrl = options.sourceUrl || PRIMARY_SOURCE_URL;
  const cacheTtlMs = options.cacheTtlMs === undefined ? DEFAULT_CACHE_TTL_MS : options.cacheTtlMs;
  let cache = null;
  return async function retrieve(request = {}) {
    const now = Date.now();
    if (cache && now - cache.cached_at_ms < cacheTtlMs) {
      const evidence = extractEvidence(cache.text, request.course, request.intent);
      return { ...evidenceResult(cache, request, evidence), source_cache_hit: true };
    }
    if (typeof fetchImpl !== 'function') return unavailable('source_fetch_unavailable');
    try {
      const response = await fetchImpl(sourceUrl, { method: 'GET', headers: { accept: 'text/html' } });
      if (!response || !response.ok) return unavailable(`source_http_${response?.status || 'error'}`);
      const text = stripMarkup(await response.text());
      cache = { text, source_timestamp: new Date().toISOString(), cached_at_ms: now };
      const evidence = extractEvidence(text, request.course, request.intent);
      return { ...evidenceResult(cache, request, evidence), source_cache_hit: false };
    } catch (error) {
      return unavailable(error && error.code ? String(error.code) : 'source_fetch_failed');
    }
  };
}

function evidenceResult(cache, request, evidence) {
  const requiredFact = Boolean(factPatterns(request.intent));
  const sourceUsed = requiredFact ? evidence.found : Boolean(cache.text);
  return {
    status: sourceUsed ? 'VERIFIED' : 'INSUFFICIENT',
    source_used: sourceUsed,
    source_url: PRIMARY_SOURCE_URL,
    source_timestamp: cache.source_timestamp,
    evidence: evidence.evidence,
    required_fact_found: evidence.found,
    course: request.course || null,
    intent: request.intent || null,
  };
}

function unavailable(code) {
  return { status: 'SOURCE_UNAVAILABLE', source_used: false, source_url: PRIMARY_SOURCE_URL, source_timestamp: null, required_fact_found: false, error_code: code };
}

const defaultOfficialSourceRetriever = createOfficialSourceRetriever();

module.exports = { PRIMARY_SOURCE_URL, DEFAULT_CACHE_TTL_MS, createOfficialSourceRetriever, defaultOfficialSourceRetriever, extractEvidence, stripMarkup };
