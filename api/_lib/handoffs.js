'use strict';

const { getDatabase } = require('./db');
const persistence = require('../../handoff/omega-handoff-persistence');

const PRIVATE_KEY = /(transcript|raw|secret|token|password|netroom|academic.?progress|lesson|evaluation|attempt|grade)/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_KEY.test(key)).map(([key, item]) => [key, sanitize(item)]));
}

function sanitizedHandoff(row) {
  if (!row) return null;
  return {
    handoff_id: row.handoff_id,
    conversation_id: row.conversation_id,
    status: row.status,
    handoff_context: sanitize(row.handoff_context),
    claimed_by: row.claimed_by,
    claimed_at: row.claimed_at,
    resolution: sanitize(row.resolution),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function listHandoffs() {
  const result = await getDatabase().query(`SELECT handoff_id, conversation_id, status, handoff_context, claimed_by, claimed_at, resolution, created_at, updated_at
    FROM public.omega_handoffs WHERE status IN ('WAITING_HUMAN', 'HUMAN_ACTIVE') ORDER BY created_at ASC`);
  return result.rows.map(sanitizedHandoff);
}

async function getHandoff(handoffId) {
  const result = await getDatabase().query(`SELECT handoff_id, conversation_id, status, handoff_context, claimed_by, claimed_at, resolution, created_at, updated_at
    FROM public.omega_handoffs WHERE handoff_id = $1`, [handoffId]);
  return sanitizedHandoff(result.rows[0]);
}

function lifecycleStatus(error) {
  if (error.code === 'HANDOFF_NOT_CLAIMABLE' || error.code === 'HANDOFF_NOT_RESOLVABLE') return 409;
  if (error.code === 'INVALID_CLAIM' || error.code === 'INVALID_RESOLUTION') return 400;
  return 500;
}

module.exports = { getDatabase, persistence, sanitize, sanitizedHandoff, listHandoffs, getHandoff, lifecycleStatus };
