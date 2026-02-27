import 'dotenv/config';
import fs from 'fs';
import { query } from './src/db/connection.js';

const migrationFile = './migrations/20260227063539_add_helper_requests.sql';

async function runMigration() {
  try {
    console.log('Running migration:', migrationFile);
    const sql = fs.readFileSync(migrationFile, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = sql.split(';').filter(s => s.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        console.log('Executing:', statement.substring(0, 50) + '...');
        await query(statement);
      }
    }
    
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
