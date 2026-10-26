import { getDatabaseConfig } from './connection-config.cjs';
import { getQueryLogMetadata, privateDatabaseError } from './private-errors.js';
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

    try {
      externalPool = new Pool(getDatabaseConfig(externalDbUrl));
    } catch (error) {
      throw privateDatabaseError(error, 'External database connection could not be initialized');
    }

    externalPool.on('error', (err) => {
      console.error('Unexpected error on external database idle client');
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
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed external query', getQueryLogMetadata(text, duration, res.rowCount));
    return res;
  } catch (error) {
    console.error('External database query failed', getQueryLogMetadata(text, Date.now() - start));
    throw privateDatabaseError(error, 'External database query failed');
  }
}

export async function getExternalClient() {
  const pool = getExternalPool();
  
  if (!pool) {
    throw new Error('External database not configured');
  }
  
  try {
    return await pool.connect();
  } catch (error) {
    throw privateDatabaseError(error, 'External database client could not be acquired');
  }
}
