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
        t.student_capacity
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
        tutor_name:    tutor.tutor_name,
        notion_name:   tutor.notion_name,
        capacity:      capacity,
        active_count:  active,
        to_count:      toCount,
        from_count:    fromCount,
        available:     available
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
 * 指定フォルダに新規スプレッドシートを作成し、
 * Tutor別に「受取シート」「送出シート」を作成する
 */
app.post('/export', async (c) => {
  try {
    if (!process.env.GOOGLE_CREDENTIALS_JSON) {
      return c.json({ success: false, error: 'GOOGLE_CREDENTIALS_JSON not configured' }, 500);
    }

    // --- Google認証 (Sheets + Drive スコープ) ---
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
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
      ],
    });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const drive  = google.drive({ version: 'v3', auth: authClient });

    // --- 対象フォルダID ---
    const FOLDER_ID = '1Iy0ueE_CmW7No7R0hAPKZ3S6lMMHKUiA';

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

    // Tutor名一覧を収集 (受取側 = handover_tutor_name, 送出側 = homeroom_tutor)
    const receiveeTutors = [...new Set(allRows.map(r => r.handover_tutor_name).filter(Boolean))].sort();
    const senderTutors   = [...new Set(allRows.map(r => r.homeroom_tutor).filter(Boolean))].sort();
    const allTutors = [...new Set([...receiveeTutors, ...senderTutors])].sort();

    // --- スプレッドシート新規作成 ---
    const now = new Date();
    const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const dateLabel = `${jst.getFullYear()}${String(jst.getMonth()+1).padStart(2,'0')}${String(jst.getDate()).padStart(2,'0')}`;
    const timeLabel = `${String(jst.getHours()).padStart(2,'0')}${String(jst.getMinutes()).padStart(2,'0')}`;
    const fileName = `引き継ぎ情報_${dateLabel}_${timeLabel}`;

    // シート定義を先に組み立てる
    const sheetDefs = []; // { title, type: 'receive'|'send', tutorName }
    for (const tutor of allTutors) {
      sheetDefs.push({ title: `${tutor}_受取`, type: 'receive', tutorName: tutor });
      sheetDefs.push({ title: `${tutor}_送出`, type: 'send',    tutorName: tutor });
    }

    // Sheets API で直接スプレッドシートを作成（シート定義込み）
    // ※ Drive API files.create ではなく Sheets API を使うことで
    //   サービスアカウントのマイドライブ容量問題を回避する
    const createRes = await sheets.spreadsheets.create({
      resource: {
        properties: { title: fileName },
        sheets: sheetDefs.map(def => ({
          properties: {
            title: def.title,
            gridProperties: { rowCount: 100, columnCount: 10 },
          },
        })),
      },
    });

    const spreadsheetId = createRes.data.spreadsheetId;

    // 作成されたシートのIDをsheetDefsに紐付け
    const createdSheets = createRes.data.sheets;
    const addedSheets = sheetDefs.map((def, i) => ({
      ...def,
      sheetId: createdSheets[i].properties.sheetId,
    }));

    // Drive API でフォルダに移動（supportsAllDrives: true で共有ドライブにも対応）
    // 現在の親フォルダを取得して removeParents に指定する
    const fileMeta = await drive.files.get({
      fileId: spreadsheetId,
      fields: 'parents',
      supportsAllDrives: true,
    });
    const currentParents = (fileMeta.data.parents || []).join(',');

    await drive.files.update({
      fileId: spreadsheetId,
      addParents: FOLDER_ID,
      removeParents: currentParents,
      supportsAllDrives: true,
      fields: 'id, webViewLink, parents',
    });

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

    // --- 各シートにデータ書き込み ---
    const HEADER = ['生徒名', '担当Tutor', '引き継ぎ先Tutor', 'Notionリンク', 'Discordリンク'];

    const valueData = [];    // values.batchUpdate用
    const formatRequests = []; // formatting用

    for (const sheet of addedSheets) {
      let rows;
      if (sheet.type === 'receive') {
        // 受取: 自分が引き継ぎ先 (handover_tutor_name === tutorName)
        rows = allRows.filter(r => r.handover_tutor_name === sheet.tutorName);
      } else {
        // 送出: 自分が担当 (homeroom_tutor === tutorName)
        rows = allRows.filter(r => r.homeroom_tutor === sheet.tutorName);
      }

      const sheetValues = [HEADER];
      for (const r of rows) {
        sheetValues.push([
          r.name             || '',
          r.homeroom_tutor   || '',
          r.handover_tutor_name || '',
          r.notion_url       || '',
          r.discord_url      || '',
        ]);
      }

      valueData.push({
        range: `'${sheet.title}'!A1`,
        values: sheetValues,
      });

      // ヘッダー行の背景色設定
      const headerColor = sheet.type === 'receive'
        ? { red: 0.24, green: 0.52, blue: 0.78 }   // 青系 (受取)
        : { red: 0.18, green: 0.62, blue: 0.45 };   // 緑系 (送出)

      formatRequests.push({
        repeatCell: {
          range: {
            sheetId: sheet.sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 5,
          },
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
      formatRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: sheet.sheetId,
            gridProperties: { frozenRowCount: 1 },
          },
          fields: 'gridProperties.frozenRowCount',
        },
      });

      // 列幅調整 (A:生徒名=140, B:担当Tutor=130, C:引継先=130, D:Notion=250, E:Discord=250)
      const colWidths = [140, 130, 130, 250, 250];
      colWidths.forEach((w, i) => {
        formatRequests.push({
          updateDimensionProperties: {
            range: {
              sheetId: sheet.sheetId,
              dimension: 'COLUMNS',
              startIndex: i,
              endIndex: i + 1,
            },
            properties: { pixelSize: w },
            fields: 'pixelSize',
          },
        });
      });
    }

    // 一括書き込み
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: valueData,
      },
    });

    // 一括フォーマット
    if (formatRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests: formatRequests },
      });
    }

    console.log(`[Handover Export] Created spreadsheet: ${spreadsheetUrl}`);
    return c.json({
      success: true,
      spreadsheetUrl,
      spreadsheetId,
      fileName,
      sheetCount: addedSheets.length,
    });

  } catch (error) {
    console.error('[Handover Export] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
