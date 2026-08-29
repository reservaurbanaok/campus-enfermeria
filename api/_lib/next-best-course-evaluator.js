'use strict';

const PRIMARY_SOURCE_URL = 'https://campusprofesionalenfermeria.com/';
const EVALUATION_VERSION = 'next-best-course-v1';
const STATUSES = new Set(['YES', 'NO', 'HUMAN_REVIEW', 'INSUFFICIENT_DATA']);
const GENERIC_TOKENS = new Set(['salud', 'enfermeria', 'curso', 'cursos', 'para', 'con', 'en', 'de', 'y', 'del', 'la', 'el']);

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function tokens(value) {
  return new Set(normalizeText(value).split(/[^a-z0-9]+/).filter((item) => item.length >= 3 && !GENERIC_TOKENS.has(item)));
}

function isOfficialSourceUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'campusprofesionalenfermeria.com' && (url.pathname === '/' || url.pathname.length > 1);
  } catch {
    return false;
  }
}

function base(status, extra = {}) {
  return { recommendation_status: status, evaluation_version: EVALUATION_VERSION, ...extra };
}

function normalizeCatalog(catalog) {
  if (!catalog || catalog.source_verified !== true || catalog.source_url !== PRIMARY_SOURCE_URL || !Array.isArray(catalog.courses)) return null;
  const courses = catalog.courses.filter((course) => course && typeof course === 'object' && typeof course.course_id === 'string' && typeof course.name === 'string' && Array.isArray(course.fit_tags) && isOfficialSourceUrl(course.source_ref || PRIMARY_SOURCE_URL));
  return courses.length ? courses : null;
}

function completionEvidence(projection, completedCourseId) {
  return (projection?.evidence_events || []).find((event) => event.event_type === 'course_completed' && event.course_id === completedCourseId) || null;
}

function evaluateNextBestCourse(input = {}) {
  const projection = input.projection || {};
  if (projection.status === 'HUMAN_REVIEW_REQUIRED' || projection.current_lifecycle_state === 'CONFLICTED') {
    return base('HUMAN_REVIEW', { reason: 'CONFLICTING_LIFECYCLE_EVIDENCE', handoff_needed: true });
  }
  if (projection.status !== 'NEXT_COURSE_EVALUATION_ELIGIBLE' || projection.current_lifecycle_state !== 'COMPLETED') {
    return base('NO', { reason_codes: ['LIFECYCLE_NOT_COMPLETED'] });
  }

  const completedCourseId = typeof input.completed_course_id === 'string' ? input.completed_course_id.trim() : '';
  if (!completedCourseId || !completionEvidence(projection, completedCourseId)) {
    return base('HUMAN_REVIEW', { reason: 'COMPLETION_COURSE_REFERENCE_MISMATCH', handoff_needed: true });
  }

  const goals = Array.isArray(input.goals) ? input.goals.filter((goal) => typeof goal === 'string' && goal.trim()).map((goal) => goal.trim()) : [];
  if (!goals.length) return base('INSUFFICIENT_DATA', { missing_evidence: ['explicit_goal_or_interest'] });

  const catalogCourses = normalizeCatalog(input.catalog);
  if (!catalogCourses) return base('INSUFFICIENT_DATA', { missing_evidence: ['verified_official_catalog_from_primary_source'] });

  const goalTokens = new Set(goals.flatMap((goal) => [...tokens(goal)]));
  const candidates = catalogCourses.filter((course) => course.course_id !== completedCourseId).map((course) => {
    const fitTokens = new Set(course.fit_tags.flatMap((tag) => [...tokens(tag)]));
    const matched = [...goalTokens].filter((token) => fitTokens.has(token));
    return { course, matched, score: matched.length };
  }).filter((candidate) => candidate.score > 0);
  if (!candidates.length) return base('NO', { reason_codes: ['NO_REASONABLE_FIT'] });
  const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
  const best = candidates.filter((candidate) => candidate.score === bestScore);
  if (best.length !== 1) return base('HUMAN_REVIEW', { reason: 'MULTIPLE_EQUAL_FIT_COURSES', handoff_needed: true });

  const selected = best[0];
  const sourceRef = selected.course.source_ref || PRIMARY_SOURCE_URL;
  return base('YES', {
    recommended_course_id: selected.course.course_id,
    recommended_course_name: selected.course.name,
    fit_reasons: selected.matched.map((token) => `coincide con el interés explícito: ${token}`),
    evidence: { completed_course_id: completedCourseId, explicit_goals: goals, matched_fit_tags: selected.matched },
    source_refs: [PRIMARY_SOURCE_URL, sourceRef],
    next_action: 'REVIEW_RECOMMENDATION_BEFORE_PRESENTING_TO_STUDENT',
  });
}

module.exports = { PRIMARY_SOURCE_URL, EVALUATION_VERSION, STATUSES, isOfficialSourceUrl, normalizeCatalog, evaluateNextBestCourse };
