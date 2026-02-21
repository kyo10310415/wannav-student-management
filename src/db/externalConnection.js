import pg from 'pg';
const { Pool } = pg;

let externalPool;

export function getExternalPool() {
  if (!externalPool) {
    const externalDbUrl = process.env.EXTERNAL_DATABASE_URL;
    
    if (!externalDbUrl) {
      console.warn('EXTERNAL_DATABASE_URL not configured');
      return null;
    }

    externalPool = new Pool({
      connectionString: externalDbUrl,
      ssl: {
        rejectUnauthorized: false
      }
    });

    externalPool.on('error', (err) => {
      console.error('Unexpected error on external DB idle client', err);
    });
  }

  return externalPool;
}

export async function queryExternal(text, params) {
  const pool = getExternalPool();
  
  if (!pool) {
    throw new Error('External database not configured');
  }

  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('Executed external query', { text, duration, rows: res.rowCount });
  return res;
}

export async function getExternalClient() {
  const pool = getExternalPool();
  
  if (!pool) {
    throw new Error('External database not configured');
  }
  
  return await pool.connect();
}
