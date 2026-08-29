'use strict';

const { Pool } = require('pg');

let pool;
function getDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('database_unconfigured');
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return { query: async (text, params) => {
    const result = await pool.query(text, params);
    return { rows: result.rows || [] };
  } };
}

module.exports = { getDatabase };
