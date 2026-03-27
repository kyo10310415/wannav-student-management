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
  },
  {
    version: 10,
    name: 'create_broadcast_images_table',
    up: `
      -- Create broadcast_images table for persistent image storage
      CREATE TABLE IF NOT EXISTS broadcast_images (
        id SERIAL PRIMARY KEY,
        image_id VARCHAR(100) UNIQUE NOT NULL,
        filename VARCHAR(255) NOT NULL,
        content_type VARCHAR(50) NOT NULL,
        file_size INTEGER NOT NULL,
        image_data BYTEA NOT NULL,
        uploaded_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_broadcast_images_image_id ON broadcast_images(image_id);
      CREATE INDEX IF NOT EXISTS idx_broadcast_images_uploaded_by ON broadcast_images(uploaded_by);
    `,
    down: `
      DROP TABLE IF EXISTS broadcast_images;
    `
  },
  {
    version: 11,
    name: 'create_survey_stamp_rally_tables',
    up: `
      -- 1. アンケート回答記録テーブル
      CREATE TABLE IF NOT EXISTS survey_responses (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(50) NOT NULL,
        response_month VARCHAR(7) NOT NULL,
        responded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
        UNIQUE (student_id, response_month)
      );
      
      CREATE INDEX IF NOT EXISTS idx_survey_responses_student_id ON survey_responses(student_id);
      CREATE INDEX IF NOT EXISTS idx_survey_responses_response_month ON survey_responses(response_month);
      
      -- 2. ルーレット結果テーブル
      CREATE TABLE IF NOT EXISTS roulette_results (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(50) NOT NULL,
        result VARCHAR(20) NOT NULL,
        probability INTEGER NOT NULL,
        roulette_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_roulette_results_student_id ON roulette_results(student_id);
      CREATE INDEX IF NOT EXISTS idx_roulette_results_created_at ON roulette_results(created_at);
      
      -- 3. スタンプラリー達成記録テーブル
      CREATE TABLE IF NOT EXISTS stamp_rally_achievements (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(50) NOT NULL,
        achievement_type VARCHAR(50) NOT NULL,
        achievement_date DATE NOT NULL,
        notified_at TIMESTAMP,
        roulette_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_stamp_rally_achievements_student_id ON stamp_rally_achievements(student_id);
      CREATE INDEX IF NOT EXISTS idx_stamp_rally_achievements_achievement_date ON stamp_rally_achievements(achievement_date);
    `,
    down: `
      DROP TABLE IF EXISTS stamp_rally_achievements;
      DROP TABLE IF EXISTS roulette_results;
      DROP TABLE IF EXISTS survey_responses;
    `
  },
  {
    version: 12,
    name: 'create_system_settings_table',
    up: `
      -- システム設定テーブル
      CREATE TABLE IF NOT EXISTS system_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        description TEXT,
        updated_by VARCHAR(100),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(setting_key);
      
      -- デフォルト値を挿入
      INSERT INTO system_settings (setting_key, setting_value, description, updated_by)
      VALUES 
        ('survey_notification_enabled', 'false', 'アンケート特典通知のON/OFF', 'system')
      ON CONFLICT (setting_key) DO NOTHING;
      
      COMMENT ON TABLE system_settings IS 'システム全体の設定を管理';
      COMMENT ON COLUMN system_settings.setting_key IS '設定キー（一意）';
      COMMENT ON COLUMN system_settings.setting_value IS '設定値（JSON文字列も可）';
      COMMENT ON COLUMN system_settings.description IS '設定の説明';
      COMMENT ON COLUMN system_settings.updated_by IS '最終更新者';
      COMMENT ON COLUMN system_settings.updated_at IS '最終更新日時';
    `,
    down: `DROP TABLE IF EXISTS system_settings;`
  },
  {
    version: 13,
    name: 'add_pro_plan_fields',
    up: `
      -- PROプラン関連のカラムを追加
      ALTER TABLE students ADD COLUMN IF NOT EXISTS pro_plan_start_date DATE;
      
      -- コメント追加
      COMMENT ON COLUMN students.pro_plan_start_date IS 'PROプラン開始日（月初の1日）';
      
      -- インデックス作成
      CREATE INDEX IF NOT EXISTS idx_students_pro_plan_start_date ON students(pro_plan_start_date);
    `,
    down: `
      DROP INDEX IF EXISTS idx_students_pro_plan_start_date;
      ALTER TABLE students DROP COLUMN IF EXISTS pro_plan_start_date;
    `
  },
  {
    version: 14,
    name: 'add_vq_diagnosis_notifications',
    up: `
      -- VQ診断通知履歴テーブル
      CREATE TABLE IF NOT EXISTS vq_diagnosis_notifications (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(50) NOT NULL,
        student_name VARCHAR(255),
        total_score INTEGER,
        diagnosis_type VARCHAR(100),
        overview TEXT,
        details TEXT,
        discord_message_id VARCHAR(100),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'sent',
        error_message TEXT,
        FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_vq_diagnosis_student_id ON vq_diagnosis_notifications(student_id);
      CREATE INDEX IF NOT EXISTS idx_vq_diagnosis_sent_at ON vq_diagnosis_notifications(sent_at);
      
      COMMENT ON TABLE vq_diagnosis_notifications IS 'VQ診断結果のディスコード通知履歴';
      
      -- システム設定追加
      INSERT INTO system_settings (setting_key, setting_value, description, updated_by)
      VALUES ('vq_diagnosis_notification_enabled', 'false', 'VQ診断通知のON/OFF', 'system')
      ON CONFLICT (setting_key) DO NOTHING;
    `,
    down: `
      DROP TABLE IF EXISTS vq_diagnosis_notifications;
      DELETE FROM system_settings WHERE setting_key = 'vq_diagnosis_notification_enabled';
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
