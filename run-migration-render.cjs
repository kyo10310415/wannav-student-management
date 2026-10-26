const { getDatabaseConfig } = require('./src/db/connection-config.cjs');
const { Pool } = require('pg');
const fs = require('fs');

// Render.com の DATABASE_URL を使用
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

const pool = new Pool({
  ...getDatabaseConfig(DATABASE_URL, process.env, true),
  connectionTimeoutMillis: 10000,
});

async function runMigration() {
  try {
    console.log('Connecting to Render.com PostgreSQL...');
    
    console.log('Adding lesson_time column...');
    await pool.query('ALTER TABLE lessons ADD COLUMN IF NOT EXISTS lesson_time VARCHAR(10)');
    console.log('✅ Column added');
    
    console.log('Creating index...');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_lessons_time ON lessons(lesson_time)');
    console.log('✅ Index created');
    
    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

runMigration();
