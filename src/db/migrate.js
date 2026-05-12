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
  },
  {
    version: 15,
    name: 'fix_vq_diagnosis_student_id_type',
    up: `
      -- VQ診断通知テーブルのstudent_idをVARCHAR(学籍番号)からINTEGER(students.id)に変更
      DROP TABLE IF EXISTS vq_diagnosis_notifications CASCADE;
      
      CREATE TABLE vq_diagnosis_notifications (
        id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        student_name VARCHAR(255),
        total_score INTEGER,
        diagnosis_type VARCHAR(100),
        overview TEXT,
        details TEXT,
        diagnosis_date VARCHAR(20),
        discord_message_id VARCHAR(100),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'sent',
        error_message TEXT,
        sheet_row_number INTEGER
      );
      
      CREATE INDEX idx_vq_diagnosis_student_id ON vq_diagnosis_notifications(student_id);
      CREATE INDEX idx_vq_diagnosis_sent_at ON vq_diagnosis_notifications(sent_at);
      
      COMMENT ON TABLE vq_diagnosis_notifications IS 'VQ診断結果のディスコード通知履歴';
      COMMENT ON COLUMN vq_diagnosis_notifications.student_id IS '生徒ID（studentsテーブルのidへの外部キー）';
      
      -- システム設定追加
      INSERT INTO system_settings (setting_key, setting_value, description, updated_by)
      VALUES ('vq_diagnosis_last_checked_row', '1', 'VQ診断スプレッドシートの最終チェック行', 'system')
      ON CONFLICT (setting_key) DO NOTHING;
    `,
    down: `
      DROP TABLE IF EXISTS vq_diagnosis_notifications CASCADE;
    `
  },
  {
    version: 16,
    name: 'create_vq_diagnosis_images_table',
    up: `
      -- VQ診断タイプ別画像設定テーブル
      CREATE TABLE IF NOT EXISTS vq_diagnosis_images (
        id SERIAL PRIMARY KEY,
        diagnosis_type VARCHAR(100) UNIQUE NOT NULL,
        image_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX idx_vq_diagnosis_images_type ON vq_diagnosis_images(diagnosis_type);
      
      COMMENT ON TABLE vq_diagnosis_images IS 'VQ診断タイプ別のディスコード送信画像設定';
      COMMENT ON COLUMN vq_diagnosis_images.diagnosis_type IS '診断タイプ（例: Vタイプ・型A）';
      COMMENT ON COLUMN vq_diagnosis_images.image_url IS 'ディスコードで送信する画像のURL';
    `,
    down: `
      DROP TABLE IF EXISTS vq_diagnosis_images CASCADE;
    `
  },
  {
    version: 17,
    name: 'create_lesson_reports_table',
    up: `
      -- レッスン報告テーブル作成
      CREATE TABLE IF NOT EXISTS lesson_reports (
        id SERIAL PRIMARY KEY,
        student_id TEXT NOT NULL,
        lesson_date DATE NOT NULL,
        lesson_result TEXT NOT NULL,
        lesson_number TEXT NOT NULL,
        pro_curriculum TEXT,
        pro_text_number TEXT,
        tutor_name TEXT,
        reported_by TEXT,
        reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, lesson_date)
      );
      
      CREATE INDEX IF NOT EXISTS idx_lesson_reports_student_id ON lesson_reports(student_id);
      CREATE INDEX IF NOT EXISTS idx_lesson_reports_lesson_date ON lesson_reports(lesson_date);
      CREATE INDEX IF NOT EXISTS idx_lesson_reports_lesson_result ON lesson_reports(lesson_result);
      CREATE INDEX IF NOT EXISTS idx_lesson_reports_tutor_name ON lesson_reports(tutor_name);
      
      COMMENT ON TABLE lesson_reports IS 'レッスン報告データ';
      COMMENT ON COLUMN lesson_reports.student_id IS '学籍番号';
      COMMENT ON COLUMN lesson_reports.lesson_date IS 'レッスン実施日';
      COMMENT ON COLUMN lesson_reports.lesson_result IS 'レッスン結果（実施済み、生徒様都合でリスケ、Tutor都合でリスケ、無断キャンセル）';
      COMMENT ON COLUMN lesson_reports.lesson_number IS 'レッスン番号（1～28、PROプラン）';
      COMMENT ON COLUMN lesson_reports.pro_curriculum IS 'PROプランカリキュラム名';
      COMMENT ON COLUMN lesson_reports.pro_text_number IS 'PROプランテキスト番号（1～12）';
      COMMENT ON COLUMN lesson_reports.tutor_name IS '担当Tutor名';
      COMMENT ON COLUMN lesson_reports.reported_by IS '報告者';
      COMMENT ON COLUMN lesson_reports.reported_at IS '報告日時';
      COMMENT ON COLUMN lesson_reports.updated_at IS '更新日時';
    `,
    down: `
      DROP TABLE IF EXISTS lesson_reports CASCADE;
    `
  },
  {
    version: 18,
    name: 'create_red_list_table',
    up: `
      -- レッドリストテーブル作成
      CREATE TABLE IF NOT EXISTS red_list (
        id SERIAL PRIMARY KEY,
        student_id TEXT NOT NULL,
        year_month TEXT NOT NULL,
        satisfaction_score INTEGER DEFAULT 0,
        absence_score INTEGER DEFAULT 0,
        survey_score INTEGER DEFAULT 0,
        reschedule_score INTEGER DEFAULT 0,
        reservation_score INTEGER DEFAULT 0,
        total_score INTEGER DEFAULT 0,
        rank TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, year_month)
      );
      
      CREATE INDEX IF NOT EXISTS idx_red_list_student_id ON red_list(student_id);
      CREATE INDEX IF NOT EXISTS idx_red_list_year_month ON red_list(year_month);
      CREATE INDEX IF NOT EXISTS idx_red_list_rank ON red_list(rank);
      CREATE INDEX IF NOT EXISTS idx_red_list_total_score ON red_list(total_score);
      
      COMMENT ON TABLE red_list IS 'レッドリスト（生徒の注意レベル管理）';
      COMMENT ON COLUMN red_list.student_id IS '学籍番号';
      COMMENT ON COLUMN red_list.year_month IS '対象年月（YYYY-MM形式）';
      COMMENT ON COLUMN red_list.satisfaction_score IS 'レッスン満足度スコア（0-4点）';
      COMMENT ON COLUMN red_list.absence_score IS '欠席スコア（0-3点）';
      COMMENT ON COLUMN red_list.survey_score IS 'アンケート未回答スコア（0-1点）';
      COMMENT ON COLUMN red_list.reschedule_score IS 'リスケスコア（0-1点）';
      COMMENT ON COLUMN red_list.reservation_score IS '予約不足スコア（0-1点）';
      COMMENT ON COLUMN red_list.total_score IS '合計スコア（0-10点）';
      COMMENT ON COLUMN red_list.rank IS 'ランク（high: 7+, middle: 4-6, low: 3, none: 0-2）';
    `,
    down: `
      DROP TABLE IF EXISTS red_list CASCADE;
    `
  },
  {
    version: 19,
    name: 'add_red_list_enhancements',
    up: `
      -- レッドリスト履歴テーブル作成
      CREATE TABLE IF NOT EXISTS red_list_history (
        id SERIAL PRIMARY KEY,
        student_id TEXT NOT NULL,
        year_month TEXT NOT NULL,
        final_score INTEGER,
        final_rank TEXT,
        satisfaction_score INTEGER DEFAULT 0,
        absence_score INTEGER DEFAULT 0,
        survey_score INTEGER DEFAULT 0,
        reschedule_score INTEGER DEFAULT 0,
        reservation_score INTEGER DEFAULT 0,
        archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_red_list_history_student_id ON red_list_history(student_id);
      CREATE INDEX IF NOT EXISTS idx_red_list_history_year_month ON red_list_history(year_month);
      
      COMMENT ON TABLE red_list_history IS 'レッドリスト履歴（月末の最終スコアを保存）';
      COMMENT ON COLUMN red_list_history.student_id IS '学籍番号';
      COMMENT ON COLUMN red_list_history.year_month IS '対象年月（YYYY-MM形式）';
      COMMENT ON COLUMN red_list_history.final_score IS '月末の最終合計スコア';
      COMMENT ON COLUMN red_list_history.final_rank IS '月末の最終ランク';
      
      -- red_list テーブルに予約ロックフラグを追加
      ALTER TABLE red_list ADD COLUMN IF NOT EXISTS reservation_locked BOOLEAN DEFAULT FALSE;
      
      COMMENT ON COLUMN red_list.reservation_locked IS '予約不足が10日時点で確定したかどうか';
    `,
    down: `
      DROP TABLE IF EXISTS red_list_history CASCADE;
      ALTER TABLE red_list DROP COLUMN IF EXISTS reservation_locked;
    `
  },
  {
    version: 21,
    name: 'add_consultation_fields_to_roulette_results',
    up: `
      -- コンサル担当と対応状況をroulette_resultsテーブルに追加
      ALTER TABLE roulette_results 
        ADD COLUMN IF NOT EXISTS consultation_staff VARCHAR(100),
        ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT '未連絡';
      
      -- 対応状況のインデックスを作成
      CREATE INDEX IF NOT EXISTS idx_roulette_results_status ON roulette_results(status);
    `,
    down: `
      ALTER TABLE roulette_results 
        DROP COLUMN IF EXISTS consultation_staff,
        DROP COLUMN IF EXISTS status;
      
      DROP INDEX IF EXISTS idx_roulette_results_status;
    `
  },
  {
    version: 22,
    name: 'add_satisfaction_avg_to_red_list',
    up: `
      -- Add satisfaction_avg column to red_list table
      ALTER TABLE red_list ADD COLUMN IF NOT EXISTS satisfaction_avg NUMERIC(4, 2);
      
      COMMENT ON COLUMN red_list.satisfaction_avg IS 'Actual satisfaction average (0-10 scale)';
    `,
    down: `
      ALTER TABLE red_list DROP COLUMN IF EXISTS satisfaction_avg;
    `
  },
  {
    version: 23,
    name: 'add_completed_at_to_roulette_results',
    up: `
      -- Add completed_at column to track when status changed to '実施済み'
      ALTER TABLE roulette_results ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
      
      -- Add index for querying completed winners
      CREATE INDEX IF NOT EXISTS idx_roulette_results_completed_at ON roulette_results(completed_at);
      
      COMMENT ON COLUMN roulette_results.completed_at IS '実施済みに変更された日時';
    `,
    down: `
      DROP INDEX IF EXISTS idx_roulette_results_completed_at;
      ALTER TABLE roulette_results DROP COLUMN IF EXISTS completed_at;
    `
  },
  {
    version: 24,
    name: 'add_is_test_to_roulette_results',
    up: `
      -- Add is_test column to distinguish test data
      ALTER TABLE roulette_results ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;
      
      -- Add index for filtering test/production data
      CREATE INDEX IF NOT EXISTS idx_roulette_results_is_test ON roulette_results(is_test);
      
      COMMENT ON COLUMN roulette_results.is_test IS 'テストデータかどうか';
    `,
    down: `
      DROP INDEX IF EXISTS idx_roulette_results_is_test;
      ALTER TABLE roulette_results DROP COLUMN IF EXISTS is_test;
    `
  },
  {
    version: 25,
    name: 'add_leader_email_to_tutors',
    up: `
      -- Add leader_email column to tutors table
      ALTER TABLE tutors ADD COLUMN IF NOT EXISTS leader_email VARCHAR(255);
      
      -- Add index for querying by leader email
      CREATE INDEX IF NOT EXISTS idx_tutors_leader_email ON tutors(leader_email);
      
      COMMENT ON COLUMN tutors.leader_email IS 'リーダーのメールアドレス';
    `,
    down: `
      DROP INDEX IF EXISTS idx_tutors_leader_email;
      ALTER TABLE tutors DROP COLUMN IF EXISTS leader_email;
    `
  },
  {
    version: 26,
    name: 'add_red_list_discord_features',
    up: `
      -- レッドリスト用 送信メッセージテンプレート管理テーブル
      CREATE TABLE IF NOT EXISTS red_list_messages (
        id           SERIAL PRIMARY KEY,
        title        VARCHAR(100) NOT NULL,
        content      TEXT NOT NULL,
        created_by   VARCHAR(255),
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      COMMENT ON TABLE red_list_messages IS 'レッドリスト Discord 送信用メッセージテンプレート';
      COMMENT ON COLUMN red_list_messages.title   IS 'テンプレートタイトル（管理用）';
      COMMENT ON COLUMN red_list_messages.content IS '送信メッセージ本文';

      -- レッドリスト Discord 送信ログテーブル
      CREATE TABLE IF NOT EXISTS red_list_discord_logs (
        id             SERIAL PRIMARY KEY,
        student_id     VARCHAR(50) NOT NULL,
        year_month     VARCHAR(7)  NOT NULL,
        message_id     INTEGER REFERENCES red_list_messages(id) ON DELETE SET NULL,
        message_title  VARCHAR(100),
        message_content TEXT NOT NULL,
        sent_by        VARCHAR(255),
        sent_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_rl_discord_logs_student ON red_list_discord_logs(student_id);
      CREATE INDEX IF NOT EXISTS idx_rl_discord_logs_year_month ON red_list_discord_logs(year_month);
      CREATE INDEX IF NOT EXISTS idx_rl_discord_logs_sent_at ON red_list_discord_logs(sent_at DESC);

      COMMENT ON TABLE red_list_discord_logs IS 'レッドリスト Discord 送信履歴';
    `,
    down: `
      DROP TABLE IF EXISTS red_list_discord_logs CASCADE;
      DROP TABLE IF EXISTS red_list_messages CASCADE;
    `
  },
  {
    version: 27,
    name: 'add_image_to_red_list_messages',
    up: `
      ALTER TABLE red_list_messages
        ADD COLUMN IF NOT EXISTS image_data         BYTEA,
        ADD COLUMN IF NOT EXISTS image_filename     VARCHAR(255),
        ADD COLUMN IF NOT EXISTS image_content_type VARCHAR(100);

      COMMENT ON COLUMN red_list_messages.image_data         IS '添付画像バイナリデータ（JPEG/PNG）';
      COMMENT ON COLUMN red_list_messages.image_filename     IS '添付画像ファイル名';
      COMMENT ON COLUMN red_list_messages.image_content_type IS '添付画像 MIME タイプ';
    `,
    down: `
      ALTER TABLE red_list_messages
        DROP COLUMN IF EXISTS image_data,
        DROP COLUMN IF EXISTS image_filename,
        DROP COLUMN IF EXISTS image_content_type;
    `
  },
  {
    version: 29,
    name: 'add_correspondence_status_to_red_list',
    up: `
      ALTER TABLE red_list
        ADD COLUMN IF NOT EXISTS correspondence_status VARCHAR(20) DEFAULT '未対応',
        ADD COLUMN IF NOT EXISTS assigned_to           VARCHAR(255);

      COMMENT ON COLUMN red_list.correspondence_status IS '対応状況（未対応 / 対応中 / 対応済み）';
      COMMENT ON COLUMN red_list.assigned_to           IS '担当者名（Discord送信者が自動セット）';
    `,
    down: `
      ALTER TABLE red_list
        DROP COLUMN IF EXISTS correspondence_status,
        DROP COLUMN IF EXISTS assigned_to;
    `
  },
  {
    version: 28,
    name: 'add_red_list_senders',
    up: `
      CREATE TABLE IF NOT EXISTS red_list_senders (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(100) NOT NULL,
        booking_url  TEXT NOT NULL,
        created_by   VARCHAR(255),
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      COMMENT ON TABLE red_list_senders IS 'レッドリスト Discord 送信者マスタ';
      COMMENT ON COLUMN red_list_senders.name        IS '送信者名';
      COMMENT ON COLUMN red_list_senders.booking_url IS '予約URL';
    `,
    down: `
      DROP TABLE IF EXISTS red_list_senders;
    `
  },
  {
    version: 30,
    name: 'add_broadcast_jobs',
    up: `
      CREATE TABLE IF NOT EXISTS broadcast_jobs (
        job_id        VARCHAR(64) PRIMARY KEY,
        broadcast_id  INTEGER REFERENCES broadcast_messages(id),
        status        VARCHAR(20) NOT NULL DEFAULT 'pending',
        total         INTEGER NOT NULL DEFAULT 0,
        sent          INTEGER NOT NULL DEFAULT 0,
        failed        INTEGER NOT NULL DEFAULT 0,
        is_test       BOOLEAN NOT NULL DEFAULT false,
        created_by    VARCHAR(255),
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      COMMENT ON TABLE broadcast_jobs              IS '一斉送信バックグラウンドジョブ管理';
      COMMENT ON COLUMN broadcast_jobs.job_id      IS 'ジョブID (フロントエンドがポーリングに使用)';
      COMMENT ON COLUMN broadcast_jobs.status      IS 'pending / running / completed / failed';
      COMMENT ON COLUMN broadcast_jobs.total       IS '送信対象人数';
      COMMENT ON COLUMN broadcast_jobs.sent        IS '送信成功件数';
      COMMENT ON COLUMN broadcast_jobs.failed      IS '送信失敗件数';
    `,
    down: `
      DROP TABLE IF EXISTS broadcast_jobs;
    `
  },
  {
    version: 31,
    name: 'create_handover_assignments',
    up: `
      CREATE TABLE IF NOT EXISTS handover_assignments (
        id                  SERIAL PRIMARY KEY,
        student_id          VARCHAR(50) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
        handover_tutor_name VARCHAR(255),
        assigned_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        reset_at            TIMESTAMP WITH TIME ZONE,
        created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_handover_assignments_student
        ON handover_assignments(student_id);

      COMMENT ON TABLE handover_assignments IS '引き継ぎ管理: 生徒ごとの引き継ぎ先Tutor割り当て';
      COMMENT ON COLUMN handover_assignments.student_id          IS '生徒ID';
      COMMENT ON COLUMN handover_assignments.handover_tutor_name IS '引き継ぎ先Tutor名';
      COMMENT ON COLUMN handover_assignments.reset_at            IS '最後にリセットされた日時 (毎月10日)';
    `,
    down: `
      DROP INDEX IF EXISTS idx_handover_assignments_student;
      DROP TABLE IF EXISTS handover_assignments;
    `
  },
  {
    version: 32,
    name: 'fix_handover_assignments_student_id_type',
    up: `
      -- v31で INTEGER で作成してしまった student_id を VARCHAR(50) に修正
      -- 既存テーブルが存在する場合のみ再作成
      DROP TABLE IF EXISTS handover_assignments;

      CREATE TABLE IF NOT EXISTS handover_assignments (
        id                  SERIAL PRIMARY KEY,
        student_id          VARCHAR(50) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
        handover_tutor_name VARCHAR(255),
        assigned_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        reset_at            TIMESTAMP WITH TIME ZONE,
        created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_handover_assignments_student
        ON handover_assignments(student_id);

      COMMENT ON TABLE handover_assignments IS '引き継ぎ管理: 生徒ごとの引き継ぎ先Tutor割り当て';
      COMMENT ON COLUMN handover_assignments.student_id          IS '生徒ID (students.student_id)';
      COMMENT ON COLUMN handover_assignments.handover_tutor_name IS '引き継ぎ先Tutor名';
      COMMENT ON COLUMN handover_assignments.reset_at            IS '最後にリセットされた日時 (毎月10日)';
    `,
    down: `
      DROP INDEX IF EXISTS idx_handover_assignments_student;
      DROP TABLE IF EXISTS handover_assignments;
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
