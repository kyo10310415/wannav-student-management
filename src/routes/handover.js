import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { google } from 'googleapis';

const app = new Hono();

/**
 * GET /api/handover/students
 * 引き継ぎ管理対象生徒一覧 + 今月残りレッスン数
 * アクティブ かつ 永久会員・休会・在籍プラン以外
 */
app.get('/students', async (c) => {
  try {
    // 今月の今日以降の日付範囲（JST）
    const now = new Date();
    const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    // 今日の JST 0:00
    const todayJst = new Date(jst.getFullYear(), jst.getMonth(), jst.getDate());
    // 今月末 JST 23:59:59
    const monthEnd = new Date(jst.getFullYear(), jst.getMonth() + 1, 0, 23, 59, 59);

    // 今月残りレッスン数: 今日以降のレッスンを生徒ごとに集計
    const remainingResult = await query(`
      SELECT
        student_id,
        COUNT(*) AS remaining_lessons
      FROM lessons
      WHERE lesson_date >= $1
        AND lesson_date <= $2
      GROUP BY student_id
    `, [todayJst.toISOString(), monthEnd.toISOString()]);

    const remainingMap = {};
    for (const row of remainingResult.rows) {
      remainingMap[row.student_id] = parseInt(row.remaining_lessons, 10);
    }

    const result = await query(`
      SELECT
        s.id,
        s.student_id,
        s.name,
        s.lesson_progress,
        s.contract_plan,
        s.homeroom_tutor,
        s.notion_url,
        s.discord_url,
        s.status,
        s.created_at,
        s.lesson_start_date,
        s.suspension_months,
        COALESCE(ha.handover_tutor_name, '') AS handover_tutor_name,
        ha.assigned_at,
        ha.reset_at
      FROM students s
      LEFT JOIN handover_assignments ha ON ha.student_id = s.student_id
      WHERE
        s.status = 'アクティブ'
        AND s.contract_plan NOT IN ('永久会員', '休会', '在籍プラン')
      ORDER BY s.student_id ASC NULLS LAST, s.name ASC
    `);

    // 今月残りレッスン数を付加
    const data = result.rows.map(row => ({
      ...row,
      remaining_lessons: remainingMap[row.student_id] || 0
    }));

    return c.json({ success: true, data });
  } catch (error) {
    console.error('[Handover] Error fetching students:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * PUT /api/handover/students/:studentId/assignment
 * 引き継ぎ先Tutorを設定／更新
 */
app.put('/students/:studentId/assignment', async (c) => {
  try {
    const studentId = c.req.param('studentId');
    const { handover_tutor_name } = await c.req.json();

    if (!studentId) {
      return c.json({ success: false, error: 'Invalid student ID' }, 400);
    }

    // Upsert: insert or update
    const result = await query(
      `INSERT INTO handover_assignments (student_id, handover_tutor_name, assigned_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (student_id)
       DO UPDATE SET
         handover_tutor_name = EXCLUDED.handover_tutor_name,
         assigned_at = NOW(),
         updated_at  = NOW()
       RETURNING *`,
      [studentId, handover_tutor_name || null]
    );

    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[Handover] Error updating assignment:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /api/handover/tutor-sidebar
 * 右サイドバー用: Tutor名 + 引き継ぎ可能人数
 * 計算式: student_capacity - activeStudents - 引き継ぎ先件数(受取) + 引き継ぎ元件数(送出)
 *
 * 例) AさんのTutor担当生徒の引き継ぎ先がBさんの場合
 *   → Aさん: +1（送り出し）、Bさん: -1（受け取り）
 */
app.get('/tutor-sidebar', async (c) => {
  try {
    // 1. すべてのTutorを取得
    const tutorsResult = await query(`
      SELECT
        t.id,
        t.tutor_name,
        t.notion_name,
        t.student_capacity,
        t.responsible_section
      FROM tutors t
      WHERE t.tutor_name IS NOT NULL
        AND t.tutor_name <> ''
      ORDER BY t.tutor_name ASC
    `);

    // 2. アクティブ生徒数を notion_name ベースで集計
    //    (students.homeroom_tutor = tutors.notion_name)
    //    永久会員・在籍プランを除外（tutors ページと同じ計算式）
    const activeCountResult = await query(`
      SELECT
        homeroom_tutor,
        COUNT(*) AS cnt
      FROM students
      WHERE status = 'アクティブ'
        AND contract_plan NOT IN ('永久会員', '在籍プラン')
      GROUP BY homeroom_tutor
    `);
    const activeCountMap = {};
    for (const row of activeCountResult.rows) {
      activeCountMap[row.homeroom_tutor] = parseInt(row.cnt, 10);
    }

    // 2b. セクション別人数を notion_name ベースで集計
    //     getLessonSection() と同じルール:
    //       progress <= 9  → C
    //       <= 18          → B
    //       <= 28          → A
    //       > 28 or Pro    → Pro
    const sectionCountResult = await query(`
      SELECT
        homeroom_tutor,
        SUM(CASE WHEN contract_plan = 'PROプラン' OR lesson_progress = 'Proプラン' THEN 1 ELSE 0 END) AS section_pro,
        SUM(CASE WHEN contract_plan <> 'PROプラン' AND lesson_progress <> 'Proプラン'
                      AND lesson_progress ~ '^[0-9]+$' AND lesson_progress::int > 28 THEN 1 ELSE 0 END) AS section_a_over,
        SUM(CASE WHEN contract_plan <> 'PROプラン' AND lesson_progress <> 'Proプラン'
                      AND lesson_progress ~ '^[0-9]+$' AND lesson_progress::int BETWEEN 19 AND 28 THEN 1 ELSE 0 END) AS section_a,
        SUM(CASE WHEN contract_plan <> 'PROプラン' AND lesson_progress <> 'Proプラン'
                      AND lesson_progress ~ '^[0-9]+$' AND lesson_progress::int BETWEEN 10 AND 18 THEN 1 ELSE 0 END) AS section_b,
        SUM(CASE WHEN contract_plan <> 'PROプラン' AND lesson_progress <> 'Proプラン'
                      AND (lesson_progress IS NULL OR lesson_progress = '' OR (lesson_progress ~ '^[0-9]+$' AND lesson_progress::int <= 9)) THEN 1 ELSE 0 END) AS section_c
      FROM students
      WHERE status = 'アクティブ'
        AND contract_plan NOT IN ('永久会員', '在籍プラン')
      GROUP BY homeroom_tutor
    `);
    // sectionCountMap: notion_name → { Pro, A, B, C }
    const sectionCountMap = {};
    for (const row of sectionCountResult.rows) {
      sectionCountMap[row.homeroom_tutor] = {
        Pro: parseInt(row.section_pro, 10) || 0,
        A:   (parseInt(row.section_a, 10) || 0) + (parseInt(row.section_a_over, 10) || 0),
        B:   parseInt(row.section_b, 10) || 0,
        C:   parseInt(row.section_c, 10) || 0
      };
    }

    // 3. 引き継ぎ割り当て情報を取得
    //    引き継ぎ先Tutor名 + 担当Tutor（homeroom_tutor = notion_name）を一緒に取得
    const assignmentResult = await query(`
      SELECT
        ha.handover_tutor_name,
        s.homeroom_tutor
      FROM handover_assignments ha
      JOIN students s ON s.student_id = ha.student_id
      WHERE ha.handover_tutor_name IS NOT NULL
        AND ha.handover_tutor_name <> ''
    `);

    // 引き継ぎ先Tutor名 → 受け取り件数（-1される側）
    const handoverToMap = {};   // key: tutor_name (引き継ぎ先)
    // 担当Tutor notion_name → 送り出し件数（+1される側）
    const handoverFromMap = {}; // key: notion_name (担当Tutor)

    for (const row of assignmentResult.rows) {
      // 受け取り側 (引き継ぎ先Tutor)
      handoverToMap[row.handover_tutor_name] = (handoverToMap[row.handover_tutor_name] || 0) + 1;
      // 送り出し側 (担当Tutor = homeroom_tutor = notion_name)
      if (row.homeroom_tutor) {
        handoverFromMap[row.homeroom_tutor] = (handoverFromMap[row.homeroom_tutor] || 0) + 1;
      }
    }

    // 4. 各Tutorの引き継ぎ可能人数を計算
    const data = tutorsResult.rows.map(tutor => {
      const capacity  = tutor.student_capacity != null ? parseInt(tutor.student_capacity, 10) : null;
      const active    = activeCountMap[tutor.notion_name] || 0;
      // 引き継ぎ先として受け取る件数（マイナス）
      const toCount   = handoverToMap[tutor.tutor_name] || 0;
      // 担当生徒が引き継ぎに出ている件数（プラス）
      const fromCount = handoverFromMap[tutor.notion_name] || 0;
      const available = capacity != null ? capacity - active - toCount + fromCount : null;

      return {
        tutor_name:           tutor.tutor_name,
        notion_name:          tutor.notion_name,
        capacity:             capacity,
        active_count:         active,
        to_count:             toCount,
        from_count:           fromCount,
        available:            available,
        responsible_section:  tutor.responsible_section || null,
        section_counts:       sectionCountMap[tutor.notion_name] || { Pro: 0, A: 0, B: 0, C: 0 }
      };
    });

    return c.json({ success: true, data });
  } catch (error) {
    console.error('[Handover] Error fetching tutor sidebar:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /api/handover/new-assignments
 * 新規割り振り対象生徒一覧
 * ステータス = 'レッスン準備中' かつ lesson_start_date が翌月
 * lesson_start_date は 'yyyy/mm/dd' 形式で保存されている
 */
app.get('/new-assignments', async (c) => {
  try {
    // JST で翌月の年・月を計算
    const now = new Date();
    const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const nextMonth = new Date(jst.getFullYear(), jst.getMonth() + 1, 1);
    const nextYear  = nextMonth.getFullYear();
    const nextMon   = nextMonth.getMonth() + 1; // 1-indexed

    // 今月残りレッスン数（引き継ぎ管理と同じロジック）
    const todayJst = new Date(jst.getFullYear(), jst.getMonth(), jst.getDate());
    const monthEnd = new Date(jst.getFullYear(), jst.getMonth() + 1, 0, 23, 59, 59);

    const remainingResult = await query(`
      SELECT
        student_id,
        COUNT(*) AS remaining_lessons
      FROM lessons
      WHERE lesson_date >= $1
        AND lesson_date <= $2
      GROUP BY student_id
    `, [todayJst.toISOString(), monthEnd.toISOString()]);

    const remainingMap = {};
    for (const row of remainingResult.rows) {
      remainingMap[row.student_id] = parseInt(row.remaining_lessons, 10);
    }

    // lesson_start_date は 'yyyy/mm/dd' 形式の TEXT or DATE
    // EXTRACT で年・月を比較する
    const result = await query(`
      SELECT
        s.id,
        s.student_id,
        s.name,
        s.lesson_progress,
        s.contract_plan,
        s.homeroom_tutor,
        s.notion_url,
        s.discord_url,
        s.status,
        s.created_at,
        s.lesson_start_date,
        COALESCE(ha.handover_tutor_name, '') AS handover_tutor_name,
        ha.assigned_at,
        ha.reset_at
      FROM students s
      LEFT JOIN handover_assignments ha ON ha.student_id = s.student_id
      WHERE
        s.status = 'レッスン準備中'
        AND s.lesson_start_date IS NOT NULL
        AND s.lesson_start_date <> ''
        AND TO_DATE(s.lesson_start_date::TEXT, 'YYYY/MM/DD') >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Tokyo') + INTERVAL '1 month'
        AND TO_DATE(s.lesson_start_date::TEXT, 'YYYY/MM/DD') <  DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Tokyo') + INTERVAL '2 month'
      ORDER BY s.lesson_start_date ASC, s.student_id ASC
    `);

    const data = result.rows.map(row => ({
      ...row,
      remaining_lessons: remainingMap[row.student_id] || 0
    }));

    return c.json({ success: true, data, next_month: `${nextYear}/${String(nextMon).padStart(2, '0')}` });
  } catch (error) {
    console.error('[Handover] Error fetching new assignments:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/handover/reset
 * 引き継ぎ先Tutorを一括リセット (毎月10日 スケジューラーから呼ぶ)
 */
app.post('/reset', async (c) => {
  try {
    const result = await query(`
      UPDATE handover_assignments
      SET handover_tutor_name = NULL,
          reset_at            = NOW(),
          updated_at          = NOW()
      WHERE handover_tutor_name IS NOT NULL
        AND handover_tutor_name <> ''
      RETURNING id
    `);

    console.log(`[Handover] Monthly reset: cleared ${result.rowCount} assignments`);
    return c.json({ success: true, cleared: result.rowCount });
  } catch (error) {
    console.error('[Handover] Error resetting assignments:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/handover/export
 * 引き継ぎ情報をGoogleスプレッドシートに書き出す
 *
 * 方式: 既存スプレッドシート (HANDOVER_EXPORT_SHEET_ID) にタイムスタンプ付きの
 * グループシートを追加する。毎回「YYYYMMDD_HHmm_Tutor名_受取/送出」形式のシートを作成。
 * ※ 新規スプレッドシート作成はサービスアカウント権限が必要なため避ける。
 */
app.post('/export', async (c) => {
  try {
    if (!process.env.GOOGLE_CREDENTIALS_JSON) {
      return c.json({ success: false, error: 'GOOGLE_CREDENTIALS_JSON not configured' }, 500);
    }
    if (!process.env.HANDOVER_EXPORT_SHEET_ID) {
      return c.json({ success: false, error: 'HANDOVER_EXPORT_SHEET_ID not configured' }, 500);
    }

    // --- Google認証 (Sheetsスコープのみ) ---
    const credString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
    let credentials;
    try {
      credentials = credString.startsWith('{')
        ? JSON.parse(credString)
        : JSON.parse(Buffer.from(credString, 'base64').toString('utf-8'));
    } catch (e) {
      return c.json({ success: false, error: 'Invalid credentials format' }, 500);
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const spreadsheetId = process.env.HANDOVER_EXPORT_SHEET_ID;

    // --- データ取得 ---
    // 引き継ぎ管理対象 (アクティブ生徒)
    const handoverResult = await query(`
      SELECT
        s.student_id,
        s.name,
        s.homeroom_tutor,
        s.notion_url,
        s.discord_url,
        COALESCE(ha.handover_tutor_name, '') AS handover_tutor_name
      FROM students s
      LEFT JOIN handover_assignments ha ON ha.student_id = s.student_id
      WHERE
        s.status = 'アクティブ'
        AND s.contract_plan NOT IN ('永久会員', '休会', '在籍プラン')
        AND ha.handover_tutor_name IS NOT NULL
        AND ha.handover_tutor_name <> ''
      ORDER BY ha.handover_tutor_name ASC, s.homeroom_tutor ASC, s.student_id ASC
    `);

    // 新規割り振り対象 (レッスン準備中・翌月開始)
    const newAssignResult = await query(`
      SELECT
        s.student_id,
        s.name,
        s.homeroom_tutor,
        s.notion_url,
        s.discord_url,
        COALESCE(ha.handover_tutor_name, '') AS handover_tutor_name
      FROM students s
      LEFT JOIN handover_assignments ha ON ha.student_id = s.student_id
      WHERE
        s.status = 'レッスン準備中'
        AND s.lesson_start_date IS NOT NULL
        AND s.lesson_start_date <> ''
        AND TO_DATE(s.lesson_start_date::TEXT, 'YYYY/MM/DD') >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Tokyo') + INTERVAL '1 month'
        AND TO_DATE(s.lesson_start_date::TEXT, 'YYYY/MM/DD') <  DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Tokyo') + INTERVAL '2 month'
        AND ha.handover_tutor_name IS NOT NULL
        AND ha.handover_tutor_name <> ''
      ORDER BY ha.handover_tutor_name ASC, s.homeroom_tutor ASC, s.student_id ASC
    `);

    // 全データを統合
    const allRows = [
      ...handoverResult.rows.map(r => ({ ...r, type: '引き継ぎ管理' })),
      ...newAssignResult.rows.map(r => ({ ...r, type: '新規割り振り' })),
    ];

    // Tutor名一覧を収集
    const receiveeTutors = [...new Set(allRows.map(r => r.handover_tutor_name).filter(Boolean))].sort();
    const senderTutors   = [...new Set(allRows.map(r => r.homeroom_tutor).filter(Boolean))].sort();
    const allTutors = [...new Set([...receiveeTutors, ...senderTutors])].sort();

    // --- タイムスタンプ ---
    const now = new Date();
    const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const dateLabel = `${jst.getFullYear()}${String(jst.getMonth()+1).padStart(2,'0')}${String(jst.getDate()).padStart(2,'0')}`;
    const timeLabel = `${String(jst.getHours()).padStart(2,'0')}${String(jst.getMinutes()).padStart(2,'0')}`;
    const tsPrefix  = `${dateLabel}_${timeLabel}`;  // 例: 20260520_2100

    // --- 既存シート一覧を取得（重複名回避） ---
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTitles = new Set(meta.data.sheets.map(s => s.properties.title));

    // シート定義: Tutor別「受取」「送出」
    // シート名: "YYYYMMDD_HHmm_Tutor名_受取" 形式
    const sheetDefs = [];
    for (const tutor of allTutors) {
      const recvTitle = `${tsPrefix}_${tutor}_受取`;
      const sendTitle = `${tsPrefix}_${tutor}_送出`;
      sheetDefs.push({ title: recvTitle, type: 'receive', tutorName: tutor });
      sheetDefs.push({ title: sendTitle, type: 'send',    tutorName: tutor });
    }

    // --- シートを一括追加 ---
    const addRequests = sheetDefs
      .filter(def => !existingTitles.has(def.title))
      .map(def => ({
        addSheet: {
          properties: {
            title: def.title,
            gridProperties: { rowCount: 100, columnCount: 10 },
          },
        },
      }));

    const batchRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: addRequests },
    });

    // 追加されたシートのIDを取得
    const addedReplies = batchRes.data.replies.filter(r => r.addSheet);
    const addedSheets  = sheetDefs.map((def, i) => ({
      ...def,
      sheetId: addedReplies[i]?.addSheet?.properties?.sheetId,
    })).filter(s => s.sheetId != null);

    // --- 各シートにデータ書き込み ---
    const HEADER = ['生徒名', '担当Tutor', '引き継ぎ先Tutor', 'Notionリンク', 'Discordリンク'];

    const valueData    = [];
    const formatReqs   = [];

    for (const sheet of addedSheets) {
      const rows = sheet.type === 'receive'
        ? allRows.filter(r => r.handover_tutor_name === sheet.tutorName)
        : allRows.filter(r => r.homeroom_tutor      === sheet.tutorName);

      const sheetValues = [HEADER, ...rows.map(r => [
        r.name                || '',
        r.homeroom_tutor      || '',
        r.handover_tutor_name || '',
        r.notion_url          || '',
        r.discord_url         || '',
      ])];

      valueData.push({
        range: `'${sheet.title}'!A1`,
        values: sheetValues,
      });

      // ヘッダー色 (受取=青, 送出=緑)
      const headerColor = sheet.type === 'receive'
        ? { red: 0.24, green: 0.52, blue: 0.78 }
        : { red: 0.18, green: 0.62, blue: 0.45 };

      formatReqs.push({
        repeatCell: {
          range: { sheetId: sheet.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 5 },
          cell: {
            userEnteredFormat: {
              backgroundColor: headerColor,
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      });

      // 1行目を凍結
      formatReqs.push({
        updateSheetProperties: {
          properties: { sheetId: sheet.sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      });

      // 列幅 (生徒名=140, 担当=130, 引継先=130, Notion=250, Discord=250)
      [140, 130, 130, 250, 250].forEach((w, i) => {
        formatReqs.push({
          updateDimensionProperties: {
            range: { sheetId: sheet.sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
            properties: { pixelSize: w },
            fields: 'pixelSize',
          },
        });
      });
    }

    // 一括書き込み
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: { valueInputOption: 'USER_ENTERED', data: valueData },
    });

    // 一括フォーマット
    if (formatReqs.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests: formatReqs },
      });
    }

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    console.log(`[Handover Export] Wrote ${addedSheets.length} sheets to: ${spreadsheetUrl}`);

    return c.json({
      success: true,
      spreadsheetUrl,
      spreadsheetId,
      exportLabel: tsPrefix,
      sheetCount: addedSheets.length,
    });

  } catch (error) {
    console.error('[Handover Export] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
