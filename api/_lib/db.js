'use strict';

const { neon } = require('@neondatabase/serverless');

let client;
function getDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('database_unconfigured');
  if (!client) client = neon(process.env.DATABASE_URL);
  return { query: async (text, params) => {
    const rows = await client.query(text, params);
    return { rows: Array.isArray(rows) ? rows : (rows.rows || []) };
  } };
}

module.exports = { getDatabase };
