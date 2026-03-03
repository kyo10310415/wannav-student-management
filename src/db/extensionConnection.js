import pg from 'pg';
const { Pool } = pg;

let extensionPool;

export function getExtensionPool() {
  if (!extensionPool) {
    const extensionDbUrl = process.env.EXTENSION_DATABASE_URL;
    
    if (!extensionDbUrl) {
      console.warn('EXTENSION_DATABASE_URL not configured');
      return null;
    }

    extensionPool = new Pool({
      connectionString: extensionDbUrl,
      ssl: {
        rejectUnauthorized: false
      }
    });

    extensionPool.on('error', (err) => {
      console.error('Unexpected error on extension DB idle client', err);
    });

    console.log('✅ Extension DB pool initialized');
  }

  return extensionPool;
}

export async function queryExtension(text, params) {
  const pool = getExtensionPool();
  
  if (!pool) {
    throw new Error('Extension database not configured');
  }

  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('Executed extension query', { text, duration, rows: res.rowCount });
  return res;
}

export async function getExtensionClient() {
  const pool = getExtensionPool();
  
  if (!pool) {
    throw new Error('Extension database not configured');
  }
  
  return await pool.connect();
}
