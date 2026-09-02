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

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&iacute;/gi, 'í')
    .replace(/&eacute;/gi, 'é')
    .replace(/&aacute;/gi, 'á')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCatalogItems(sourceHtml) {
  const html = String(sourceHtml || '');
  const items = [];
  const pattern = /class=["'][^"']*\bcurso-card-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of html.matchAll(pattern)) {
    const item = decodeEntities(String(match[1] || '').replace(/<[^>]+>/g, ' '));
    if (item && !items.includes(item)) items.push(item);
  }
  return items;
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
  if (value === 'REQUIREMENTS') return /requisitos|dirigido a\s*:?\s*[^.;|]{1,180}/i;
  if (value === 'PROMOTION') return /promoci[oó]n|descuento|bonific|\boff\b|forma de pago/i;
  if (value === 'ENROLLMENT_INTENT') return /inscrib|formulario oficial/i;
  return null;
}

function extractEvidence(sourceText, course, intent, sourceHtml) {
  const text = String(sourceText || '');
  const lower = normalized(text);
  const aliases = courseAliases(course).map(normalized);
  const aliasCandidates = aliases.flatMap((alias) => {
    const indexes = [];
    let from = 0;
    while (alias && (from = lower.indexOf(alias, from)) >= 0) {
      indexes.push(from);
      from += alias.length;
    }
    return indexes;
  }).sort((left, right) => right - left);
  const markerCandidates = COURSE_MARKERS.filter((marker) => aliases.some((alias) => marker.includes(alias)))
    .map((marker) => lower.lastIndexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => right - left);
  // Prefer the detailed course title over repeated card and legal/footer copy.
  const courseCandidates = markerCandidates.length ? markerCandidates : aliasCandidates;
  const courseIndex = courseCandidates.find((index) => !/todos los derechos reservados|avalado por instituto ferrer/.test(lower.slice(index, index + 240))) ?? -1;
  const nextBoundary = COURSE_MARKERS.map((marker) => lower.indexOf(marker, Math.max(0, courseIndex + 200)))
    .filter((index) => index > courseIndex)
    .sort((left, right) => left - right)[0];
  const pattern = factPatterns(intent);
  if (!pattern && String(intent || '').toUpperCase() === 'EXPLORE_OPTIONS') {
    const catalogItems = extractCatalogItems(sourceHtml);
    return {
      found: catalogItems.length > 0,
      evidence: catalogItems.length ? `Current official Campus catalog: ${catalogItems.join('; ')}` : '',
      catalog_items: catalogItems,
    };
  }
  if (!pattern) return { found: Boolean(courseIndex >= 0), evidence: courseIndex >= 0 ? text.slice(courseIndex, Math.min(courseIndex + 8000, nextBoundary || courseIndex + 8000)) : '', catalog_items: [] };
  if (pattern && courseIndex < 0) return { found: false, evidence: '' };
  const start = courseIndex >= 0 ? Math.max(0, courseIndex - 50) : 0;
  // The Campus page contains summary cards before each full course block.
  // Stop at the next course marker so facts cannot bleed between courses.
  const normalizedText = normalized(text);
  const factBoundary = COURSE_MARKERS.map((marker) => normalizedText.indexOf(marker, start + 200)).filter((index) => index > start).sort((a, b) => a - b)[0];
  const window = text.slice(start, Math.min(start + 16000, factBoundary || start + 16000));
  const match = window.match(pattern);
  return { found: Boolean(match), evidence: match ? window.slice(Math.max(0, match.index - 120), match.index + match[0].length + 220) : '', catalog_items: [] };
}

function createOfficialSourceRetriever(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sourceUrl = options.sourceUrl || PRIMARY_SOURCE_URL;
  const cacheTtlMs = options.cacheTtlMs === undefined ? DEFAULT_CACHE_TTL_MS : options.cacheTtlMs;
  let cache = null;
  return async function retrieve(request = {}) {
    const now = Date.now();
    if (cache && now - cache.cached_at_ms < cacheTtlMs) {
      const evidence = extractEvidence(cache.text, request.course, request.intent, cache.html);
      return { ...evidenceResult(cache, request, evidence), source_cache_hit: true };
    }
    if (typeof fetchImpl !== 'function') return unavailable('source_fetch_unavailable');
    try {
      const response = await fetchImpl(sourceUrl, { method: 'GET', headers: { accept: 'text/html' } });
      if (!response || !response.ok) return unavailable(`source_http_${response?.status || 'error'}`);
      const html = await response.text();
      const text = stripMarkup(html);
      cache = { html, text, source_timestamp: new Date().toISOString(), cached_at_ms: now };
      const evidence = extractEvidence(text, request.course, request.intent, cache.html);
      return { ...evidenceResult(cache, request, evidence), source_cache_hit: false };
    } catch (error) {
      return unavailable(error && error.code ? String(error.code) : 'source_fetch_failed');
    }
  };
}

function evidenceResult(cache, request, evidence) {
  const requiredFact = Boolean(factPatterns(request.intent));
  const catalogRequest = String(request.intent || '').toUpperCase() === 'EXPLORE_OPTIONS';
  const sourceUsed = requiredFact || catalogRequest ? evidence.found : Boolean(cache.text);
  return {
    status: sourceUsed ? 'VERIFIED' : 'INSUFFICIENT',
    source_used: sourceUsed,
    source_url: PRIMARY_SOURCE_URL,
    source_timestamp: cache.source_timestamp,
    evidence: evidence.evidence,
    required_fact_found: evidence.found,
    catalog_items: evidence.catalog_items || [],
    course: request.course || null,
    intent: request.intent || null,
  };
}

function unavailable(code) {
  return { status: 'SOURCE_UNAVAILABLE', source_used: false, source_url: PRIMARY_SOURCE_URL, source_timestamp: null, required_fact_found: false, error_code: code };
}

const defaultOfficialSourceRetriever = createOfficialSourceRetriever();

module.exports = { PRIMARY_SOURCE_URL, DEFAULT_CACHE_TTL_MS, createOfficialSourceRetriever, defaultOfficialSourceRetriever, extractEvidence, extractCatalogItems, stripMarkup };
