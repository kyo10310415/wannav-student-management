import { readFileSync, readdirSync } from 'fs';
import { query } from './src/db/connection.js';
import path from 'path';

async function runMigration() {
  try {
    const migrationFile = process.argv[2];
    
    if (migrationFile) {
      // Run specific migration file
      console.log(`Running migration: ${migrationFile}...`);
      const sql = readFileSync(migrationFile, 'utf-8');
      await query(sql);
      console.log('✅ Migration completed successfully');
    } else {
      // Run all migrations in order
      console.log('Running all migrations...');
      const migrationsDir = './migrations';
      const files = readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort(); // Sort alphabetically to run in order
      
      for (const file of files) {
        console.log(`\n📄 Running: ${file}`);
        const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');
        await query(sql);
        console.log(`✅ ${file} completed`);
      }
      
      console.log('\n✅ All migrations completed successfully');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
