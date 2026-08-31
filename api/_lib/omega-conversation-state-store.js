'use strict';

const crypto = require('crypto');
const { MemoryConversationStateStore } = require('../../core/omega-conversation-state');

const TABLE = 'public.omega_conversation_states';
const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
  conversation_key_hash TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  external_sender_hash TEXT NOT NULL,
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);`;

function digest(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

function createRuntimeConversationStateStore(options = {}) {
  const memory = options.memoryStore || new MemoryConversationStateStore();
  let database = options.db;
  let initialized = false;
  async function getDb() {
    if (database) return database;
    if (!process.env.DATABASE_URL) return null;
    try { database = require('./db').getDatabase(); return database; } catch { return null; }
  }
  async function ensure(db) {
    if (!initialized) { await db.query(CREATE_SQL, []); initialized = true; }
  }
  return {
    async load(key) {
      const local = await memory.load(key);
      const db = await getDb();
      if (!db) return local;
      try {
        await ensure(db);
        const result = await db.query(`SELECT state_json FROM ${TABLE} WHERE conversation_key_hash = $1`, [digest(key)]);
        return result.rows?.[0]?.state_json || local;
      } catch { return local; }
    },
    async save(key, state) {
      await memory.save(key, state);
      const db = await getDb();
      if (!db) return state;
      try {
        await ensure(db);
        await db.query(
          `INSERT INTO ${TABLE} (conversation_key_hash,channel,external_sender_hash,state_json,updated_at)
           VALUES ($1,$2,$3,$4::jsonb,$5)
           ON CONFLICT (conversation_key_hash) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = EXCLUDED.updated_at`,
          [digest(key), state.channel, digest(state.external_sender_id), JSON.stringify(state), state.updated_at || new Date().toISOString()],
        );
      } catch { /* memory remains a safe same-process fallback */ }
      return state;
    },
  };
}

const defaultRuntimeConversationStateStore = createRuntimeConversationStateStore();

module.exports = { TABLE, createRuntimeConversationStateStore, defaultRuntimeConversationStateStore };
