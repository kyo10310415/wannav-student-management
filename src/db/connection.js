import { getDatabaseConfig } from './connection-config.cjs';
import { getQueryLogMetadata, privateDatabaseError } from './private-errors.js';
import pg from 'pg';
const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    try {
      pool = new Pool(getDatabaseConfig(process.env.DATABASE_URL, process.env, true));
    } catch (error) {
      throw privateDatabaseError(error, 'Database connection could not be initialized');
    }

    pool.on('error', (err) => {
      console.error('Unexpected error on idle database client');
      process.exit(-1);
    });
  }

  return pool;
}

export async function query(text, params) {
  const pool = getPool();
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    const slowQueryMs = Number(process.env.DB_SLOW_QUERY_MS || 1000);
    const verboseLogging = process.env.DB_QUERY_LOGGING === 'true';

    // 本番で全SQLを出すと、一斉送信の進捗ポーリングだけでログが埋まる。
    // 明示的に有効化された場合と遅いSQLだけを、短い形式で記録する。
    if (verboseLogging || process.env.NODE_ENV !== 'production' || duration >= slowQueryMs) {
      console.log('[DB] Query completed', getQueryLogMetadata(text, duration, res.rowCount));
    }
    return res;
  } catch (error) {
    const safe = privateDatabaseError(error, 'Database query failed');
    console.error('[DB] Query failed', getQueryLogMetadata(text, Date.now() - start));
    throw safe;
  }
}

export async function getClient() {
  const pool = getPool();
  try {
    return await pool.connect();
  } catch (error) {
    throw privateDatabaseError(error, 'Database client could not be acquired');
  }
}
