'use strict';

const RESOLUTION_FIELDS = ['handoff_id', 'resolved_by', 'operator_role', 'resolution_summary', 'human_actions_taken', 'resolved_items', 'remaining_items', 'next_owner', 'ai_resume_context', 'created_at'];

function lifecycleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function createHandoff(db, handoffContext) {
  if (!handoffContext || !handoffContext.handoff_id || !handoffContext.conversation_id) throw lifecycleError('INVALID_HANDOFF_CONTEXT', 'handoff_id and conversation_id are required');
  const result = await db.query(`INSERT INTO public.omega_handoffs (handoff_id, conversation_id, status, handoff_context)
    VALUES ($1, $2, 'WAITING_HUMAN', $3::jsonb)
    RETURNING handoff_id, conversation_id, status, handoff_context, claimed_by, claimed_at, resolution, created_at, updated_at`, [handoffContext.handoff_id, handoffContext.conversation_id, JSON.stringify(handoffContext)]);
  return result.rows[0];
}

async function claimHandoff(db, handoffId, operator) {
  if (!handoffId || !operator || !operator.id || !operator.role) throw lifecycleError('INVALID_CLAIM', 'handoff_id, operator.id and operator.role are required');
  const result = await db.query(`UPDATE public.omega_handoffs
    SET status = 'HUMAN_ACTIVE', claimed_by = $2, claimed_at = NOW(), updated_at = NOW()
    WHERE handoff_id = $1 AND status = 'WAITING_HUMAN'
    RETURNING handoff_id, conversation_id, status, handoff_context, claimed_by, claimed_at, resolution, created_at, updated_at`, [handoffId, operator.id]);
  if (!result.rows[0]) throw lifecycleError('HANDOFF_NOT_CLAIMABLE', 'handoff is missing or no longer waiting');
  return result.rows[0];
}

async function resolveHandoff(db, handoffId, resolution) {
  if (!handoffId || !resolution || !['AI', 'CLOSE'].includes(resolution.next_owner)) throw lifecycleError('INVALID_RESOLUTION', 'next_owner must be AI or CLOSE');
  for (const field of RESOLUTION_FIELDS) if (field !== 'handoff_id' && (resolution[field] === undefined || resolution[field] === null)) throw lifecycleError('INVALID_RESOLUTION', `missing ${field}`);
  if (resolution.handoff_id !== handoffId) throw lifecycleError('INVALID_RESOLUTION', 'handoff_id mismatch');
  const status = resolution.next_owner === 'AI' ? 'RETURNED_TO_AI' : 'CLOSED';
  const result = await db.query(`UPDATE public.omega_handoffs
    SET status = $2, resolution = $3::jsonb, updated_at = NOW()
    WHERE handoff_id = $1 AND status = 'HUMAN_ACTIVE'
    RETURNING handoff_id, conversation_id, status, handoff_context, claimed_by, claimed_at, resolution, created_at, updated_at`, [handoffId, status, JSON.stringify(resolution)]);
  if (!result.rows[0]) throw lifecycleError('HANDOFF_NOT_RESOLVABLE', 'handoff is missing or not human-active');
  return result.rows[0];
}

module.exports = { createHandoff, claimHandoff, resolveHandoff, RESOLUTION_FIELDS };
