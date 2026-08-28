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
  },
  {
    version: 33,
    name: 'create_tutor_weekly_snapshots_table',
    up: `
      -- Tutor週次スナップショットテーブル
      -- 毎週日曜日23:59 JSTに各Tutorの満足度・回収率・満足度スコアを保存する
      CREATE TABLE IF NOT EXISTS tutor_weekly_snapshots (
        id                    SERIAL PRIMARY KEY,
        snapshot_date         DATE NOT NULL,             -- スナップショット取得日（日曜日の日付）
        tutor_notion_name     VARCHAR(255) NOT NULL,     -- tutors.notion_name
        year_month            VARCHAR(7) NOT NULL,       -- 対象年月 YYYY/M
        active_student_count  INTEGER NOT NULL DEFAULT 0,
        satisfaction_count    INTEGER NOT NULL DEFAULT 0, -- アンケート回答数
        satisfaction_avg      NUMERIC(6,4),              -- 満足度平均 (0-10スケール)
        satisfaction_value    NUMERIC(6,2),              -- 満足度 (0-100スケール)
        collection_rate       NUMERIC(6,2),              -- 回収率 (%)
        satisfaction_score    NUMERIC(6,2),              -- 満足度スコア
        created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(snapshot_date, tutor_notion_name)
      );

      CREATE INDEX IF NOT EXISTS idx_tutor_weekly_snapshots_date
        ON tutor_weekly_snapshots(snapshot_date DESC);
      CREATE INDEX IF NOT EXISTS idx_tutor_weekly_snapshots_tutor
        ON tutor_weekly_snapshots(tutor_notion_name);

      COMMENT ON TABLE tutor_weekly_snapshots IS 'Tutor週次スナップショット（毎週日曜日23:59 JSTに取得）';
      COMMENT ON COLUMN tutor_weekly_snapshots.snapshot_date IS 'スナップショット取得日（日曜日）';
      COMMENT ON COLUMN tutor_weekly_snapshots.tutor_notion_name IS 'Notion名（tutors.notion_name）';
      COMMENT ON COLUMN tutor_weekly_snapshots.year_month IS '対象年月（YYYY/M形式）';
      COMMENT ON COLUMN tutor_weekly_snapshots.satisfaction_value IS '満足度（0-100スケール）';
      COMMENT ON COLUMN tutor_weekly_snapshots.collection_rate IS '回収率（%）';
      COMMENT ON COLUMN tutor_weekly_snapshots.satisfaction_score IS '満足度スコア（満足度×回収率/100）';
    `,
    down: `
      DROP INDEX IF EXISTS idx_tutor_weekly_snapshots_tutor;
      DROP INDEX IF EXISTS idx_tutor_weekly_snapshots_date;
      DROP TABLE IF EXISTS tutor_weekly_snapshots;
    `
  },
  {
    version: 34,
    name: 'add_ex_rank_to_red_list',
    up: `
      -- red_list テーブルに EX ランクフラグを追加
      -- EX: 2ヶ月以上連続でレッドリストに入る（自動判定）または手動設定
      ALTER TABLE red_list
        ADD COLUMN IF NOT EXISTS ex_rank BOOLEAN NOT NULL DEFAULT FALSE;

      COMMENT ON COLUMN red_list.ex_rank IS 'EXランクフラグ（2ヶ月以上連続または手動設定）';

      -- red_list_history テーブルにも EX ランクフラグを追加
      ALTER TABLE red_list_history
        ADD COLUMN IF NOT EXISTS final_ex_rank BOOLEAN NOT NULL DEFAULT FALSE;

      COMMENT ON COLUMN red_list_history.final_ex_rank IS 'EXランクフラグ（月末確定値）';
    `,
    down: `
      ALTER TABLE red_list DROP COLUMN IF EXISTS ex_rank;
      ALTER TABLE red_list_history DROP COLUMN IF EXISTS final_ex_rank;
    `
  },
  {
    version: 35,
    name: 'add_ex_reason_to_red_list',
    up: `
      -- EXランク手動設定時の理由を保存するカラム
      ALTER TABLE red_list
        ADD COLUMN IF NOT EXISTS ex_reason TEXT;

      COMMENT ON COLUMN red_list.ex_reason IS 'EXランク手動設定の理由';
    `,
    down: `
      ALTER TABLE red_list DROP COLUMN IF EXISTS ex_reason;
    `
  },
  {
    version: 36,
    name: 'add_correspondence_to_red_list_history',
    up: `
      -- 対応状況・担当者を red_list_history にも追加（今月タブで設定した内容を過去タブでも表示・編集できるようにする）
      ALTER TABLE red_list_history
        ADD COLUMN IF NOT EXISTS correspondence_status VARCHAR(20) DEFAULT '未対応',
        ADD COLUMN IF NOT EXISTS assigned_to           VARCHAR(255);

      COMMENT ON COLUMN red_list_history.correspondence_status IS '対応状況（未対応 / 対応中 / 対応済み）';
      COMMENT ON COLUMN red_list_history.assigned_to IS '担当者名';
    `,
    down: `
      ALTER TABLE red_list_history
        DROP COLUMN IF EXISTS correspondence_status,
        DROP COLUMN IF EXISTS assigned_to;
    `
  },
  {
    version: 37,
    name: 'create_tutor_red_list_table',
    up: `
      -- Tutorレッドリストテーブル
      -- スコアに基づいてTutorを自動的にレッドリストに登録・管理する
      CREATE TABLE IF NOT EXISTS tutor_red_list (
        id                 SERIAL PRIMARY KEY,
        tutor_id           VARCHAR(50)  NOT NULL,          -- employee_id
        tutor_name         VARCHAR(255) NOT NULL,
        registered_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- 登録日時
        rank               VARCHAR(10)  NOT NULL DEFAULT 'Low',  -- High / Middle / Low
        total_score        INTEGER      NOT NULL DEFAULT 0,
        -- スコア内訳
        helper_request_score  INTEGER   NOT NULL DEFAULT 0,  -- 助っ人依頼点数
        attendance_score      INTEGER   NOT NULL DEFAULT 0,  -- MTG/研修/1on1出席率点数
        -- 対応状況
        correspondence_status VARCHAR(20) NOT NULL DEFAULT '未対応',  -- 未対応 / 対応中 / 対応済み
        assigned_to        VARCHAR(255),
        notes              TEXT,
        -- 登録時スナップショット（参照用）
        snapshot_satisfaction NUMERIC(5,2),  -- 登録時の満足度平均
        snapshot_team      VARCHAR(100),     -- 登録時の所属チーム
        created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tutor_id)  -- 同一Tutorは1エントリのみ（再登録時は更新）
      );

      CREATE INDEX IF NOT EXISTS idx_tutor_red_list_tutor_id  ON tutor_red_list(tutor_id);
      CREATE INDEX IF NOT EXISTS idx_tutor_red_list_rank      ON tutor_red_list(rank);
      CREATE INDEX IF NOT EXISTS idx_tutor_red_list_status    ON tutor_red_list(correspondence_status);

      COMMENT ON TABLE tutor_red_list IS 'Tutorレッドリスト（スコアベース）';
    `,
    down: `
      DROP TABLE IF EXISTS tutor_red_list;
    `
  },
  {
    version: 38,
    name: 'add_responsible_section_to_tutors',
    up: `
      ALTER TABLE tutors
        ADD COLUMN IF NOT EXISTS responsible_section VARCHAR(10) DEFAULT NULL;

      COMMENT ON COLUMN tutors.responsible_section IS '担当セクション（Pro / A / B / C）';
    `,
    down: `
      ALTER TABLE tutors DROP COLUMN IF EXISTS responsible_section;
    `
  },
  {
    version: 39,
    name: 'create_daily_reports_table',

    up: `
      CREATE TABLE IF NOT EXISTS daily_reports (
        id            SERIAL PRIMARY KEY,
        tutor_id      INTEGER NOT NULL REFERENCES tutors(id) ON DELETE CASCADE,
        report_date   DATE    NOT NULL,
        content       TEXT    NOT NULL,
        submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tutor_id, report_date)
      );

      CREATE TABLE IF NOT EXISTS daily_report_comments (
        id            SERIAL PRIMARY KEY,
        report_id     INTEGER NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content       TEXT    NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_daily_reports_tutor_id    ON daily_reports(tutor_id);
      CREATE INDEX IF NOT EXISTS idx_daily_reports_report_date ON daily_reports(report_date);
      CREATE INDEX IF NOT EXISTS idx_daily_report_comments_report_id ON daily_report_comments(report_id);

      COMMENT ON TABLE daily_reports         IS 'Tutor日報';
      COMMENT ON TABLE daily_report_comments IS '日報コメント（返信）';
    `,
    down: `
      DROP TABLE IF EXISTS daily_report_comments;
      DROP TABLE IF EXISTS daily_reports;
    `
  },
  {
    version: 40,
    name: 'add_job_title_to_users',
    up: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS job_title VARCHAR(50) DEFAULT NULL;

      COMMENT ON COLUMN users.job_title IS '役職（マネージャー / 統括 / リーダー / クルー / 部署移動 / 契約解除）';
    `,
    down: `
      ALTER TABLE users DROP COLUMN IF EXISTS job_title;
    `
  },
  {
    version: 41,
    name: 'add_daily_report_reminder_setting',
    up: `
      INSERT INTO system_settings (setting_key, setting_value, description, updated_by)
      VALUES ('daily_report_reminder_enabled', 'true', '日報未提出通知のON/OFF', 'system')
      ON CONFLICT (setting_key) DO NOTHING;
    `,
    down: `
      DELETE FROM system_settings WHERE setting_key = 'daily_report_reminder_enabled';
    `
  },
  {
    version: 42,
    name: 'create_withdrawal_requests_table',
    up: `
      CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id SERIAL PRIMARY KEY,
        student_id    VARCHAR(50)  NOT NULL,
        student_name  VARCHAR(255) NOT NULL,
        homeroom_tutor VARCHAR(255),
        withdrawal_date DATE NOT NULL,
        category      VARCHAR(50)  NOT NULL,
        reason        TEXT,
        notion_url    TEXT,
        submitted_by  VARCHAR(255),
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_student_id ON withdrawal_requests(student_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_created_at ON withdrawal_requests(created_at);

      -- テスト用生徒データ（学籍番号: 1111）
      INSERT INTO students (student_id, name, homeroom_tutor, status, contract_plan)
      VALUES ('1111', 'テスト生徒', 'テストTutor', 'アクティブ', 'レッスン中')
      ON CONFLICT (student_id) DO NOTHING;
    `,
    down: `
      DROP TABLE IF EXISTS withdrawal_requests;
      DELETE FROM students WHERE student_id = '1111';
    `
  },
  {
    version: 43,
    name: 'create_minutes_lesson_contents_tables',
    up: `
      -- 議事録テンプレートテーブル
      CREATE TABLE IF NOT EXISTS minutes_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL DEFAULT 'デフォルトテンプレート',
        template_text TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- デフォルトテンプレートを1件挿入
      INSERT INTO minutes_templates (name, template_text)
      VALUES (
        'デフォルトテンプレート',
        '# レッスン議事録

## 生徒情報
- 生徒名: {{student_name}}
- 学籍番号: {{student_id}}
- レッスン日: {{lesson_date}}
- レッスン番号: {{lesson_number}}回目

## 今回のレッスン内容
{{today_lesson_content}}

## 今日の成果・振り返り
{{summary}}

## 次回レッスン予定
{{next_lesson_content}}

## その他メモ
{{notes}}'
      )
      ON CONFLICT DO NOTHING;

      -- レッスン内容マスターテーブル（レッスン番号順に管理）
      CREATE TABLE IF NOT EXISTS lesson_contents (
        id SERIAL PRIMARY KEY,
        lesson_number INTEGER NOT NULL UNIQUE,
        title VARCHAR(255) NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_lesson_contents_lesson_number ON lesson_contents(lesson_number);

      -- 議事録テーブル
      CREATE TABLE IF NOT EXISTS minutes (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(50) NOT NULL,
        student_name VARCHAR(255),
        lesson_date DATE NOT NULL,
        lesson_number INTEGER,
        drive_file_id VARCHAR(255),
        drive_file_name TEXT,
        transcript TEXT,
        generated_text TEXT,
        template_id INTEGER REFERENCES minutes_templates(id) ON DELETE SET NULL,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_minutes_student_id ON minutes(student_id);
      CREATE INDEX IF NOT EXISTS idx_minutes_lesson_date ON minutes(lesson_date DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_minutes_student_date ON minutes(student_id, lesson_date);
    `,
    down: `
      DROP TABLE IF EXISTS minutes;
      DROP TABLE IF EXISTS lesson_contents;
      DROP TABLE IF EXISTS minutes_templates;
    `
  },
  {
    version: 44,
    name: 'update_default_minutes_template',
    up: `
      UPDATE minutes_templates
         SET template_text =
'# レッスン議事録

## 生徒情報
- 生徒名: {{student_name}}
- 学籍番号: {{student_id}}
- レッスン日: {{lesson_date}}
- レッスン番号: {{lesson_number}}回目

## 今回のレッスン内容
{{today_lesson_content}}

## 今日の成果・振り返り
{{summary}}

## 次回レッスン予定
{{next_lesson_content}}

## その他メモ
{{notes}}',
             updated_at = NOW()
       WHERE id = 1;
    `,
    down: ``
  },
  {
    version: 45,
    name: 'add_platform_feedback_to_minutes_template',
    up: `
      UPDATE minutes_templates
         SET template_text =
'# レッスン議事録

## 生徒情報
- 生徒名: {{student_name}}
- 学籍番号: {{student_id}}
- レッスン日: {{lesson_date}}
- レッスン番号: {{lesson_number}}回目

## 今回のレッスン内容
{{today_lesson_content}}

## 今日の成果・振り返り
{{summary}}

## YouTubeフィードバック
{{youtube_feedback}}

## X（Twitter）フィードバック
{{x_feedback}}

## 次回レッスン予定
{{next_lesson_content}}

## その他メモ
{{notes}}',
             updated_at = NOW()
       WHERE id = 1;
    `,
    down: ``
  },
  {
    version: 46,
    name: 'add_next_action_to_minutes_template',
    up: `
      UPDATE minutes_templates
         SET template_text =
'# レッスン議事録

## 生徒情報
- 生徒名: {{student_name}}
- 学籍番号: {{student_id}}
- レッスン日: {{lesson_date}}
- レッスン番号: {{lesson_number}}回目

## 今回のレッスン内容
{{today_lesson_content}}

## 今日の成果・振り返り
{{summary}}

## YouTubeフィードバック
{{youtube_feedback}}

## X（Twitter）フィードバック
{{x_feedback}}

## ネクストアクション・ミッション
{{next_action}}

## 次回レッスン予定
{{next_lesson_content}}

## その他メモ
{{notes}}',
             updated_at = NOW()
       WHERE id = 1;
    `,
    down: ``
  },
  {
    version: 47,
    name: 'protect_daily_reports_from_tutor_delete',
    up: `
      -- daily_reports の tutor_id FK を ON DELETE CASCADE → ON DELETE RESTRICT に変更
      -- 理由: tutors を DELETE すると日報が CASCADE で消えてしまうため
      --       キャッシュ同期でTutorが誤削除された際に日報まで消える問題を防ぐ
      ALTER TABLE daily_reports
        DROP CONSTRAINT IF EXISTS daily_reports_tutor_id_fkey;

      ALTER TABLE daily_reports
        ADD CONSTRAINT daily_reports_tutor_id_fkey
          FOREIGN KEY (tutor_id) REFERENCES tutors(id) ON DELETE RESTRICT;
    `,
    down: `
      ALTER TABLE daily_reports
        DROP CONSTRAINT IF EXISTS daily_reports_tutor_id_fkey;

      ALTER TABLE daily_reports
        ADD CONSTRAINT daily_reports_tutor_id_fkey
          FOREIGN KEY (tutor_id) REFERENCES tutors(id) ON DELETE CASCADE;
    `
  },
  {
    version: 48,
    name: 'change_lesson_number_to_text',
    up: `
      -- lesson_contents.lesson_number を INTEGER → TEXT に変更
      -- 理由: 「Pro_動画_1」などの文字列レッスン番号を入力できるようにする
      ALTER TABLE lesson_contents
        ALTER COLUMN lesson_number TYPE TEXT USING lesson_number::TEXT;

      -- minutes.lesson_number も同様に TEXT に変更
      ALTER TABLE minutes
        ALTER COLUMN lesson_number TYPE TEXT USING lesson_number::TEXT;
    `,
    down: `
      ALTER TABLE lesson_contents
        ALTER COLUMN lesson_number TYPE INTEGER USING lesson_number::INTEGER;
      ALTER TABLE minutes
        ALTER COLUMN lesson_number TYPE INTEGER USING lesson_number::INTEGER;
    `
  },
  {
    version: 49,
    name: 'add_quality_evaluation_to_minutes',
    up: `
      ALTER TABLE minutes
        ADD COLUMN IF NOT EXISTS tutor_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS tutor_employee_id VARCHAR(50),
        ADD COLUMN IF NOT EXISTS quality_evaluation JSONB;

      COMMENT ON COLUMN minutes.tutor_name IS 'レッスン実施Tutor名（レッスン報告、予約、担任の順で解決）';
      COMMENT ON COLUMN minutes.tutor_employee_id IS 'レッスン実施Tutorの従業員ID';
      COMMENT ON COLUMN minutes.quality_evaluation IS 'AIによるレッスン品質6項目の評価結果';

      -- 既存議事録はTutor名だけ可能な範囲で補完する。品質評価は再生成されたものから保存する。
      UPDATE minutes m
         SET tutor_name = COALESCE(
           (
             SELECT NULLIF(TRIM(lr.tutor_name), '')
               FROM lesson_reports lr
              WHERE lr.student_id = m.student_id
                AND lr.lesson_date::date = m.lesson_date
              ORDER BY lr.reported_at DESC
              LIMIT 1
           ),
           (
             SELECT NULLIF(TRIM(l.tutor_name), '')
               FROM lessons l
              WHERE l.student_id = m.student_id
                AND l.lesson_date::date = m.lesson_date
              ORDER BY l.updated_at DESC
              LIMIT 1
           ),
           (
             SELECT NULLIF(TRIM(t.tutor_name), '')
               FROM students s
               LEFT JOIN tutors t ON t.notion_name = s.homeroom_tutor
              WHERE s.student_id = m.student_id
              LIMIT 1
           ),
           (
             SELECT NULLIF(TRIM(s.homeroom_tutor), '')
               FROM students s
              WHERE s.student_id = m.student_id
              LIMIT 1
           )
         )
       WHERE tutor_name IS NULL OR TRIM(tutor_name) = '';

      UPDATE minutes m
         SET tutor_employee_id = (
               SELECT t.employee_id
                 FROM tutors t
                WHERE m.tutor_name = ANY(ARRAY[t.tutor_name, t.notion_name, t.name, t.email])
                ORDER BY CASE WHEN t.tutor_name = m.tutor_name THEN 0 ELSE 1 END
                LIMIT 1
             ),
             tutor_name = COALESCE(
               (
                 SELECT t.tutor_name
                   FROM tutors t
                  WHERE m.tutor_name = ANY(ARRAY[t.tutor_name, t.notion_name, t.name, t.email])
                  ORDER BY CASE WHEN t.tutor_name = m.tutor_name THEN 0 ELSE 1 END
                  LIMIT 1
               ),
               m.tutor_name
             )
       WHERE m.tutor_name IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_minutes_tutor_date
        ON minutes(tutor_employee_id, lesson_date DESC);
      CREATE INDEX IF NOT EXISTS idx_minutes_quality_evaluation
        ON minutes USING GIN(quality_evaluation);
    `,
    down: `
      DROP INDEX IF EXISTS idx_minutes_quality_evaluation;
      DROP INDEX IF EXISTS idx_minutes_tutor_date;
      ALTER TABLE minutes DROP COLUMN IF EXISTS quality_evaluation;
      ALTER TABLE minutes DROP COLUMN IF EXISTS tutor_employee_id;
      ALTER TABLE minutes DROP COLUMN IF EXISTS tutor_name;
    `
  },
  {
    version: 50,
    name: 'normalize_minutes_lesson_references',
    up: `
      -- 旧一括登録で「3,Pro_『伸び』_2」のように壊れたキーだけを、
      -- 本文中のコース名・Lesson番号から正規化する。正式な Pro_... キーは維持する。
      WITH source_rows AS (
        SELECT id,
               COALESCE(content, '') || E'\n' || COALESCE(title, '') AS source_text
          FROM lesson_contents
         WHERE lesson_number LIKE '%,Pro_%'
      ), normalized AS (
        SELECT id,
               CASE
                 WHEN source_text LIKE '%収益の最大化%' THEN 'Pro_収益'
                 WHEN source_text LIKE '%V体質化%' THEN 'Pro_V体質化'
                 WHEN source_text LIKE '%企業案件獲得術%' THEN 'Pro_案件'
                 WHEN source_text LIKE '%バズコンテンツ量産術%' THEN 'Pro_バズ'
                 WHEN source_text LIKE '%動画編集コース（アドバンス編）%' THEN 'Pro_動画アド'
                 WHEN source_text LIKE '%動画編集コース（標準編）%' THEN 'Pro_動画'
                 WHEN source_text LIKE '%YouTube活動「伸び」%'
                   OR source_text LIKE '%YouTube活動『伸び』%' THEN 'Pro_伸び'
                 ELSE NULL
               END AS prefix,
               substring(source_text FROM 'Lesson[[:space:]]*([0-9]+)') AS lesson_no,
               substring(source_text FROM 'Lesson[[:space:]]*[0-9]+([A-E])') AS variant
          FROM source_rows
      ), resolved AS (
        SELECT id,
               prefix || '_' || lesson_no ||
                 CASE
                   WHEN variant IS NULL OR variant = '' OR variant = 'A' THEN ''
                   ELSE '_' || variant
                 END AS canonical_key
          FROM normalized
         WHERE prefix IS NOT NULL
           AND lesson_no IS NOT NULL
      )
      UPDATE lesson_contents lc
         SET lesson_number = resolved.canonical_key,
             updated_at = NOW()
        FROM resolved
       WHERE lc.id = resolved.id
         AND lc.lesson_number IS DISTINCT FROM resolved.canonical_key;

      -- 「回目」をテンプレート側に固定せず、通常/PROで表示を切り替えられるようにする。
      UPDATE minutes_templates
         SET template_text = REPLACE(
               template_text,
               '{{lesson_number}}回目',
               '{{lesson_number_display}}'
             ),
             updated_at = NOW()
       WHERE template_text LIKE '%{{lesson_number}}回目%';

      -- 既存議事録の番号を現在のレッスン報告から補完する。
      WITH report_keys AS (
        SELECT student_id,
               lesson_date,
               CASE
                 WHEN lesson_number ~ '^[0-9]+$'
                   THEN (lesson_number::integer)::text
                 WHEN lesson_number = 'PROプラン' THEN
                   CASE
                     WHEN pro_curriculum LIKE '%収益の最大化%' THEN 'Pro_収益_'
                     WHEN pro_curriculum LIKE '%V体質化%' THEN 'Pro_V体質化_'
                     WHEN pro_curriculum LIKE '%企業案件獲得術%' THEN 'Pro_案件_'
                     WHEN pro_curriculum LIKE '%バズコンテンツ量産術%' THEN 'Pro_バズ_'
                     WHEN pro_curriculum LIKE '%動画編集コース（アドバンス編）%' THEN 'Pro_動画アド_'
                     WHEN pro_curriculum LIKE '%動画編集コース（標準編）%' THEN 'Pro_動画_'
                     WHEN pro_curriculum LIKE '%YouTube活動「伸び」%'
                       OR pro_curriculum LIKE '%YouTube活動『伸び』%' THEN 'Pro_伸び_'
                     ELSE NULL
                   END || NULLIF(TRIM(pro_text_number), '')
                 ELSE NULL
               END AS canonical_key
          FROM lesson_reports
      ), resolved_reports AS (
        SELECT student_id,
               lesson_date,
               canonical_key,
               CASE
                 WHEN canonical_key ~ '^[0-9]+$' THEN canonical_key || '回目'
                 ELSE canonical_key
               END AS lesson_label
          FROM report_keys
         WHERE canonical_key IS NOT NULL
      )
      UPDATE minutes m
         SET lesson_number = resolved_reports.canonical_key,
             generated_text = CASE
               WHEN m.generated_text LIKE '%- レッスン番号: （未確認）回目%'
                 THEN REPLACE(
                   m.generated_text,
                   '- レッスン番号: （未確認）回目',
                   '- レッスン番号: ' || resolved_reports.lesson_label
                 )
               ELSE m.generated_text
             END,
             updated_at = NOW()
        FROM resolved_reports
       WHERE m.student_id = resolved_reports.student_id
         AND m.lesson_date = resolved_reports.lesson_date
         AND m.lesson_number IS DISTINCT FROM resolved_reports.canonical_key;
    `,
    down: `
      UPDATE minutes_templates
         SET template_text = REPLACE(
               template_text,
               '{{lesson_number_display}}',
               '{{lesson_number}}回目'
             ),
             updated_at = NOW()
       WHERE template_text LIKE '%{{lesson_number_display}}%';
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
