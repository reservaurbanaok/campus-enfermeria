'use strict';

const INTENTS = new Set([
  'ASK_RECOMMENDATION', 'COMPARE_COURSES', 'EXPLORE_OPTIONS', 'ENROLLMENT_INTENT',
  'COURSE_QUESTION', 'PRICE', 'DURATION', 'MODALITY', 'CERTIFICATION', 'OBJECTION',
]);

function executeAdmissions({ intent, text, currentCourse, source }) {
  const selected = INTENTS.has(intent) ? 'OMEGA_ADMISSIONS' : null;
  if (!selected) return { selected_skill: null, skill_executed: false, needs_clarification: false, admissions_output: null };
  const needSignals = /trabaj|trabajo|estudi|urgenc|pediatr|adult|terapia|uci|hospital|quir[oó]fano|anest|escolar|objetivo|busco|quiero aprender|me interesa/i;
  const needsClarification = (intent === 'ASK_RECOMMENDATION' || intent === 'COMPARE_COURSES') && !currentCourse && !needSignals.test(String(text || ''));
  return {
    selected_skill: selected,
    skill_executed: true,
    needs_clarification: needsClarification,
    admissions_output: {
      intent,
      course: currentCourse || null,
      source_status: source?.status || 'SOURCE_UNAVAILABLE',
      source_evidence_available: source?.required_fact_found === true,
      next_step: needsClarification ? 'ask_for_need_or_course' : (intent === 'ENROLLMENT_INTENT' ? 'offer_official_form' : 'answer_from_verified_source'),
    },
  };
}

module.exports = { INTENTS, executeAdmissions };
