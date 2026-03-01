import { readFileSync } from 'fs';
import { query } from './src/db/connection.js';

async function runMigration() {
  try {
    const sql = readFileSync('./migrations/20260301_add_absence_management.sql', 'utf-8');
    
    console.log('Running absence management migration...');
    await query(sql);
    console.log('✅ Migration completed successfully');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
