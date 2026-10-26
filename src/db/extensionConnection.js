import { getDatabaseConfig } from './connection-config.cjs';
import { getQueryLogMetadata, privateDatabaseError } from './private-errors.js';
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

    try {
      extensionPool = new Pool(getDatabaseConfig(extensionDbUrl));
    } catch (error) {
      throw privateDatabaseError(error, 'Extension database connection could not be initialized');
    }

    extensionPool.on('error', (err) => {
      console.error('Unexpected error on extension database idle client');
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
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed extension query', getQueryLogMetadata(text, duration, res.rowCount));
    return res;
  } catch (error) {
    console.error('Extension database query failed', getQueryLogMetadata(text, Date.now() - start));
    throw privateDatabaseError(error, 'Extension database query failed');
  }
}

export async function getExtensionClient() {
  const pool = getExtensionPool();
  
  if (!pool) {
    throw new Error('Extension database not configured');
  }
  
  try {
    return await pool.connect();
  } catch (error) {
    throw privateDatabaseError(error, 'Extension database client could not be acquired');
  }
}
