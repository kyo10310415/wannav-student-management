import 'dotenv/config';
import fs from 'fs';
import pool from './src/db.js';

const migrationFile = './migrations/20260227063539_add_helper_requests.sql';

async function runMigration() {
  try {
    console.log('Running migration:', migrationFile);
    const sql = fs.readFileSync(migrationFile, 'utf8');
    await pool.query(sql);
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
