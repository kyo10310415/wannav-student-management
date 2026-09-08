import pg from 'pg';
const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
      } : false
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
      process.exit(-1);
    });
  }

  return pool;
}

export async function query(text, params) {
  const pool = getPool();
  const start = Date.now();
  const operation = text.trim().replace(/\s+/g, ' ').slice(0, 120);
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    const slowQueryMs = Number(process.env.DB_SLOW_QUERY_MS || 1000);
    const verboseLogging = process.env.DB_QUERY_LOGGING === 'true';

    // 本番で全SQLを出すと、一斉送信の進捗ポーリングだけでログが埋まる。
    // 明示的に有効化された場合と遅いSQLだけを、短い形式で記録する。
    if (verboseLogging || process.env.NODE_ENV !== 'production' || duration >= slowQueryMs) {
      console.log('[DB] Query completed', { operation, duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error('[DB] Query failed', {
      operation,
      duration: Date.now() - start,
      code: error.code,
      message: error.message
    });
    throw error;
  }
}

export async function getClient() {
  const pool = getPool();
  return await pool.connect();
}
