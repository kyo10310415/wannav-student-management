import { getPool } from './connection.js';

const migrations = [
  {
    version: 1,
    name: 'create_students_table',
    up: `
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(100),
        contract_plan VARCHAR(100),
        character_name VARCHAR(255),
        homeroom_tutor VARCHAR(255),
        notion_page_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_students_student_id ON students(student_id);
      CREATE INDEX idx_students_homeroom_tutor ON students(homeroom_tutor);
    `,
    down: `DROP TABLE IF EXISTS students;`
  },
  {
    version: 2,
    name: 'create_tutors_table',
    up: `
      CREATE TABLE IF NOT EXISTS tutors (
        id SERIAL PRIMARY KEY,
        employee_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        team VARCHAR(100),
        notion_name VARCHAR(255),
        monthly_available_hours INTEGER,
        notion_page_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_tutors_employee_id ON tutors(employee_id);
      CREATE INDEX idx_tutors_email ON tutors(email);
    `,
    down: `DROP TABLE IF EXISTS tutors;`
  },
  {
    version: 3,
    name: 'create_lessons_table',
    up: `
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        calendar_event_id VARCHAR(255) UNIQUE NOT NULL,
        student_id VARCHAR(50) NOT NULL,
        tutor_name VARCHAR(255),
        lesson_date TIMESTAMP NOT NULL,
        title VARCHAR(500),
        description TEXT,
        meet_link VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(student_id)
      );
      CREATE INDEX idx_lessons_student_id ON lessons(student_id);
      CREATE INDEX idx_lessons_lesson_date ON lessons(lesson_date);
    `,
    down: `DROP TABLE IF EXISTS lessons;`
  },
  {
    version: 4,
    name: 'create_migration_history_table',
    up: `
      CREATE TABLE IF NOT EXISTS migration_history (
        id SERIAL PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `,
    down: `DROP TABLE IF EXISTS migration_history;`
  },
  {
    version: 5,
    name: 'add_tutor_name_to_tutors',
    up: `
      ALTER TABLE tutors ADD COLUMN IF NOT EXISTS tutor_name VARCHAR(255);
      CREATE INDEX IF NOT EXISTS idx_tutors_tutor_name ON tutors(tutor_name);
    `,
    down: `
      DROP INDEX IF EXISTS idx_tutors_tutor_name;
      ALTER TABLE tutors DROP COLUMN IF EXISTS tutor_name;
    `
  }
];

async function runMigrations() {
  const pool = getPool();
  
  try {
    // Create migration_history table first if it doesn't exist
    await pool.query(migrations[3].up);
    
    for (const migration of migrations) {
      // Check if migration has already been applied
      const result = await pool.query(
        'SELECT version FROM migration_history WHERE version = $1',
        [migration.version]
      );
      
      if (result.rows.length === 0) {
        console.log(`Running migration ${migration.version}: ${migration.name}`);
        
        // Run migration
        await pool.query(migration.up);
        
        // Record migration
        await pool.query(
          'INSERT INTO migration_history (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
        
        console.log(`Migration ${migration.version} completed successfully`);
      } else {
        console.log(`Migration ${migration.version} already applied, skipping`);
      }
    }
    
    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run migrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('Migration process completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration process failed:', error);
      process.exit(1);
    });
}

export { runMigrations };
