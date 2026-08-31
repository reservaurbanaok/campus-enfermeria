'use strict';

const MAX_RECENT_TURNS = 6;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function conversationKey(channel, externalSenderId) {
  const channelValue = String(channel || '').trim().toLowerCase();
  const senderValue = String(externalSenderId || '').trim();
  if (!channelValue || !senderValue) throw new Error('conversation_identity_required');
  return `${channelValue}:${senderValue}`;
}

function createConversationState(options = {}) {
  return {
    channel: String(options.channel || 'unknown'),
    external_sender_id: String(options.external_sender_id || ''),
    conversation_id: options.conversation_id || null,
    current_course: options.current_course || null,
    current_intent: options.current_intent || null,
    unresolved_question: options.unresolved_question || null,
    handoff_state: options.handoff_state || 'none',
    raw_recent_turns: Array.isArray(options.raw_recent_turns) ? options.raw_recent_turns.slice(-MAX_RECENT_TURNS) : [],
    updated_at: options.updated_at || new Date().toISOString(),
  };
}

function appendTurn(state, role, text, timestamp = new Date().toISOString()) {
  const next = createConversationState(state);
  next.raw_recent_turns = [...next.raw_recent_turns, { role, text: String(text || '').slice(0, 500), timestamp }].slice(-MAX_RECENT_TURNS);
  next.updated_at = timestamp;
  return next;
}

class MemoryConversationStateStore {
  constructor() { this.states = new Map(); }
  async load(key) { return clone(this.states.get(key) || null); }
  async save(key, state) { this.states.set(key, clone(state)); return clone(state); }
  clear() { this.states.clear(); }
}

const defaultConversationStateStore = new MemoryConversationStateStore();

module.exports = {
  MAX_RECENT_TURNS,
  conversationKey,
  createConversationState,
  appendTurn,
  MemoryConversationStateStore,
  defaultConversationStateStore,
};
