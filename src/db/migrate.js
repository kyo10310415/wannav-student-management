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
  },
  {
    version: 6,
    name: 'add_helper_counters_to_tutors',
    up: `
      ALTER TABLE tutors ADD COLUMN IF NOT EXISTS helper_request_count INTEGER DEFAULT 0;
      ALTER TABLE tutors ADD COLUMN IF NOT EXISTS helper_accepted_count INTEGER DEFAULT 0;
      ALTER TABLE tutors ADD COLUMN IF NOT EXISTS reschedule_count INTEGER DEFAULT 0;
    `,
    down: `
      ALTER TABLE tutors DROP COLUMN IF EXISTS helper_request_count;
      ALTER TABLE tutors DROP COLUMN IF EXISTS helper_accepted_count;
      ALTER TABLE tutors DROP COLUMN IF EXISTS reschedule_count;
    `
  },
  {
    version: 7,
    name: 'add_extended_student_columns',
    up: `
      -- Add all missing columns to students table
      ALTER TABLE students ADD COLUMN IF NOT EXISTS lesson_progress INTEGER;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS notion_url TEXT;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS discord_url TEXT;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_status_prev_month VARCHAR(100);
      ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_status_curr_month VARCHAR(100);
      ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_year_month_prev VARCHAR(20);
      ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_year_month_curr VARCHAR(20);
      ALTER TABLE students ADD COLUMN IF NOT EXISTS result_score_prev_month VARCHAR(10);
      ALTER TABLE students ADD COLUMN IF NOT EXISTS absence_count INTEGER DEFAULT 0;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS lesson_start_date DATE;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS continued_months INTEGER DEFAULT 0;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS suspension_months INTEGER DEFAULT 0;
      
      -- Create indexes for commonly queried columns
      CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
      CREATE INDEX IF NOT EXISTS idx_students_contract_plan ON students(contract_plan);
      CREATE INDEX IF NOT EXISTS idx_students_continued_months ON students(continued_months);
    `,
    down: `
      DROP INDEX IF EXISTS idx_students_continued_months;
      DROP INDEX IF EXISTS idx_students_contract_plan;
      DROP INDEX IF EXISTS idx_students_status;
      
      ALTER TABLE students DROP COLUMN IF EXISTS suspension_months;
      ALTER TABLE students DROP COLUMN IF EXISTS continued_months;
      ALTER TABLE students DROP COLUMN IF EXISTS lesson_start_date;
      ALTER TABLE students DROP COLUMN IF EXISTS absence_count;
      ALTER TABLE students DROP COLUMN IF EXISTS result_score_prev_month;
      ALTER TABLE students DROP COLUMN IF EXISTS payment_year_month_curr;
      ALTER TABLE students DROP COLUMN IF EXISTS payment_year_month_prev;
      ALTER TABLE students DROP COLUMN IF EXISTS payment_status_curr_month;
      ALTER TABLE students DROP COLUMN IF EXISTS payment_status_prev_month;
      ALTER TABLE students DROP COLUMN IF EXISTS discord_url;
      ALTER TABLE students DROP COLUMN IF EXISTS notion_url;
      ALTER TABLE students DROP COLUMN IF EXISTS lesson_progress;
    `
  },
  {
    version: 8,
    name: 'add_social_media_columns',
    up: `
      -- Add YouTube channel ID and X (Twitter) account ID columns
      ALTER TABLE students ADD COLUMN IF NOT EXISTS youtube_channel_id VARCHAR(255);
      ALTER TABLE students ADD COLUMN IF NOT EXISTS x_account_id VARCHAR(255);
      
      -- Create indexes for social media columns
      CREATE INDEX IF NOT EXISTS idx_students_youtube_channel_id ON students(youtube_channel_id);
      CREATE INDEX IF NOT EXISTS idx_students_x_account_id ON students(x_account_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_students_x_account_id;
      DROP INDEX IF EXISTS idx_students_youtube_channel_id;
      
      ALTER TABLE students DROP COLUMN IF EXISTS x_account_id;
      ALTER TABLE students DROP COLUMN IF EXISTS youtube_channel_id;
    `
  },
  {
    version: 9,
    name: 'add_schedule_start_date',
    up: `
      -- Add schedule_start_date column to broadcast_messages table
      ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS schedule_start_date TIMESTAMP;
      
      -- Set default start date to created_at for existing scheduled broadcasts
      UPDATE broadcast_messages 
      SET schedule_start_date = created_at 
      WHERE is_scheduled = true AND schedule_start_date IS NULL;
    `,
    down: `
      ALTER TABLE broadcast_messages DROP COLUMN IF EXISTS schedule_start_date;
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
