import { query } from '../db/connection.js';
import { fetchSatisfactionFromCache } from '../services/cacheService.js';
import { google } from 'googleapis';

/**
 * 毎週日曜日23:59 JSTにTutorの満足度スナップショットを保存するジョブ
 *
 * 保存するデータ:
 *   - アクティブ生徒数 (その時点の実値)
 *   - アンケート回答数
 *   - 満足度平均 (0-10スケール)
 *   - 満足度 (0-100スケール)
 *   - 回収率 (%)
 *   - 満足度スコア (満足度×回収率/100)
 *
 * ※ この値は「先週日曜日時点の数値」として前週比較に使用するため、
 *   後から生徒数が変わっても変化しない確定値として保存する。
 *
 * あわせてスプレッドシートにも書き出す:
 *   シート名: "週次スナップショット"
 *   A列: Tutor名 (3行ごとにセル結合)
 *   B列: 項目名 (満足度 / 回収率 / 満足度スコア の繰り返し)
 *   C列以降: スナップショット日付ごとに蓄積
 *     1行目がヘッダー (Tutor名 / 項目 / MM/DD / MM/DD ...)
 */
export async function weeklyTutorSnapshot() {
  try {
    console.log('[Tutor Weekly Snapshot] Starting weekly snapshot...');

    // --- JST現在時刻 ---
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstTime = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000);

    // スナップショット日付（今日の日付）
    const snapshotYear  = jstTime.getFullYear();
    const snapshotMonth = jstTime.getMonth() + 1;
    const snapshotDay   = jstTime.getDate();
    const snapshotDate  = `${snapshotYear}-${String(snapshotMonth).padStart(2, '0')}-${String(snapshotDay).padStart(2, '0')}`;

    // ヘッダー用の短い日付表示 (例: 5/18)
    const snapshotLabel = `${snapshotMonth}/${snapshotDay}`;

    // 対象年月 YYYY/M
    const yearMonth = `${snapshotYear}/${snapshotMonth}`;

    console.log(`[Tutor Weekly Snapshot] snapshot_date=${snapshotDate}, year_month=${yearMonth}`);

    // --- 満足度データ取得 ---
    const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    const satisfactionRaw = await fetchSatisfactionFromCache(cacheSpreadsheetId);

    // tutorName -> yearMonth -> { average, count }
    const satisfactionByTutor = {};
    satisfactionRaw.forEach(record => {
      const tName  = record.tutor_name;
      const ym     = record.year_month;
      const score  = parseFloat(record.satisfaction_score);
      if (!tName || !ym || isNaN(score)) return;
      if (!satisfactionByTutor[tName]) satisfactionByTutor[tName] = {};
      if (!satisfactionByTutor[tName][ym])
        satisfactionByTutor[tName][ym] = { scores: [] };
      satisfactionByTutor[tName][ym].scores.push(score);
    });

    // 平均を計算してキャッシュ
    for (const tName in satisfactionByTutor) {
      for (const ym in satisfactionByTutor[tName]) {
        const d = satisfactionByTutor[tName][ym];
        d.average = d.scores.reduce((a, b) => a + b, 0) / d.scores.length;
        d.count   = d.scores.length;
      }
    }

    // --- アクティブTutor取得 ---
    const tutorsResult = await query(`
      SELECT * FROM tutors
      WHERE status = 'アクティブ'
        AND LOWER(job_type) LIKE '%tutor%'
        AND tutor_name != 'きょうへい先生'
      ORDER BY tutor_name ASC
    `);
    const tutors = tutorsResult.rows;

    // --- アクティブ生徒数 ---
    const studentsResult = await query(
      `SELECT homeroom_tutor, status, contract_plan FROM students`
    );
    const students = studentsResult.rows;

    // --- 各TutorのDB保存 & スプレッドシート用データ収集 ---
    let savedCount = 0;
    let skippedCount = 0;

    // スプレッドシート用: tutor_name -> { satisfactionValue, collectionRate, satisfactionScore }
    const sheetData = [];

    for (const tutor of tutors) {
      const activeStudentCount = students.filter(s =>
        s.homeroom_tutor === tutor.notion_name &&
        s.status === 'アクティブ' &&
        s.contract_plan !== '永久会員' &&
        s.contract_plan !== '在籍プラン'
      ).length;

      const tutorSatData = satisfactionByTutor[tutor.tutor_name] || {};
      const monthData    = tutorSatData[yearMonth];

      const satisfactionCount = monthData ? monthData.count : 0;
      const satisfactionAvg   = monthData ? monthData.average : null;

      // 満足度 (0-100スケール)
      const satisfactionValue = satisfactionAvg !== null
        ? satisfactionAvg * 10
        : null;

      // 回収率 (%)
      let collectionRate = null;
      if (activeStudentCount > 0) {
        collectionRate = (satisfactionCount / activeStudentCount) * 100;
      }

      // 満足度スコア
      let satisfactionScore = null;
      if (satisfactionValue !== null && collectionRate !== null) {
        satisfactionScore = satisfactionValue * collectionRate / 100;
      }

      // DB保存
      try {
        await query(`
          INSERT INTO tutor_weekly_snapshots
            (snapshot_date, tutor_notion_name, year_month,
             active_student_count, satisfaction_count, satisfaction_avg,
             satisfaction_value, collection_rate, satisfaction_score)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (snapshot_date, tutor_notion_name)
          DO UPDATE SET
            year_month           = EXCLUDED.year_month,
            active_student_count = EXCLUDED.active_student_count,
            satisfaction_count   = EXCLUDED.satisfaction_count,
            satisfaction_avg     = EXCLUDED.satisfaction_avg,
            satisfaction_value   = EXCLUDED.satisfaction_value,
            collection_rate      = EXCLUDED.collection_rate,
            satisfaction_score   = EXCLUDED.satisfaction_score,
            created_at           = EXCLUDED.created_at
        `, [
          snapshotDate,
          tutor.notion_name,
          yearMonth,
          activeStudentCount,
          satisfactionCount,
          satisfactionAvg,
          satisfactionValue,
          collectionRate,
          satisfactionScore
        ]);
        savedCount++;
      } catch (err) {
        console.error(`[Tutor Weekly Snapshot] Error saving ${tutor.notion_name}:`, err.message);
        skippedCount++;
      }

      // スプレッドシート用データ収集
      sheetData.push({
        tutorName:         tutor.tutor_name,
        satisfactionValue: satisfactionValue !== null ? parseFloat(satisfactionValue.toFixed(2)) : '',
        collectionRate:    collectionRate    !== null ? parseFloat(collectionRate.toFixed(2))    : '',
        satisfactionScore: satisfactionScore !== null ? parseFloat(satisfactionScore.toFixed(2)) : '',
      });
    }

    console.log(`[Tutor Weekly Snapshot] DB done. saved=${savedCount}, skipped=${skippedCount}`);

    // --- スプレッドシートへの書き出し ---
    const sheetResult = await exportSnapshotToSheet(sheetData, snapshotDate, snapshotLabel, snapshotYear);
    if (sheetResult.success) {
      console.log(`[Tutor Weekly Snapshot] Sheet export done: ${sheetResult.spreadsheetUrl}`);
    } else {
      console.warn(`[Tutor Weekly Snapshot] Sheet export failed: ${sheetResult.error}`);
    }

    return {
      success: true,
      savedCount,
      skippedCount,
      snapshotDate,
      sheetUrl: sheetResult.spreadsheetUrl || null,
    };

  } catch (error) {
    console.error('[Tutor Weekly Snapshot] Fatal error:', error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// スプレッドシートへの書き出し
//
// シート名: "週次スナップショット_YYYY"  (例: 週次スナップショット_2025)
//
// レイアウト:
//   行1 (ヘッダー): Tutor名 | 項目 | 5/4 | 5/11 | 5/18 | ...
//   行2: TutorA    | 満足度  | 値   | 値    | 値
//   行3: (結合)    | 回収率  | 値   | 値    | 値
//   行4: (結合)    | 満足度スコア | 値 | 値  | 値
//   行5: TutorB    | 満足度  | ...
//   ...
//
// 初回: シートを新規作成してヘッダー行 + 全Tutor行を書き込む
// 2回目以降: 既存シートの最終列の次に新しい日付列を追加する
// ─────────────────────────────────────────────────────────────────────────────
async function exportSnapshotToSheet(sheetData, snapshotDate, snapshotLabel, snapshotYear) {
  try {
    if (!process.env.GOOGLE_CREDENTIALS_JSON) {
      console.warn('[Snapshot Sheet] GOOGLE_CREDENTIALS_JSON not set, skipping sheet export');
      return { success: false, error: 'GOOGLE_CREDENTIALS_JSON not configured' };
    }

    // --- Google認証 ---
    const credString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
    let credentials;
    try {
      credentials = credString.startsWith('{')
        ? JSON.parse(credString)
        : JSON.parse(Buffer.from(credString, 'base64').toString('utf-8'));
    } catch (e) {
      return { success: false, error: 'Invalid credentials format' };
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const spreadsheetId = process.env.TUTOR_SATISFACTION_SHEET_ID
      || '1qlvFeFXYaA4Ul6R93qa7CiT4fdJHbrppUiI1tNl7bxg';

    const sheetName = `週次スナップショット_${snapshotYear}`;

    // --- シートが存在するか確認 ---
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = meta.data.sheets.find(s => s.properties.title === sheetName);

    // Tutor数
    const tutorCount = sheetData.length;
    // データ行数 = Tutor数 × 3行
    const dataRowCount = tutorCount * 3;

    if (!existingSheet) {
      // ── 初回: シート新規作成 ──────────────────────────────────────
      console.log(`[Snapshot Sheet] Creating new sheet: ${sheetName}`);

      const addRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: {
                  rowCount: dataRowCount + 10,
                  columnCount: 50,
                },
              },
            },
          }],
        },
      });
      const newSheetId = addRes.data.replies[0].addSheet.properties.sheetId;

      // ヘッダー行 + データ行を構築
      const headerRow = ['Tutor名', '項目', snapshotLabel];
      const rows = [headerRow];

      for (const d of sheetData) {
        rows.push([d.tutorName, '満足度',     d.satisfactionValue]);
        rows.push(['',          '回収率',      d.collectionRate]);
        rows.push(['',          '満足度スコア', d.satisfactionScore]);
      }

      // データ書き込み
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: rows },
      });

      // フォーマット: 1行目凍結 + A列凍結 + Tutor名結合
      const formatRequests = [
        {
          updateSheetProperties: {
            properties: {
              sheetId: newSheetId,
              gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 },
            },
            fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
          },
        },
      ];

      // Tutor名セル結合 (3行ごと、2列目以降はすでに空)
      for (let i = 0; i < tutorCount; i++) {
        const startRow = 1 + i * 3; // 0-indexed (ヘッダーの次)
        formatRequests.push({
          mergeCells: {
            range: {
              sheetId: newSheetId,
              startRowIndex: startRow,
              endRowIndex:   startRow + 3,
              startColumnIndex: 0,
              endColumnIndex:   1,
            },
            mergeType: 'MERGE_ALL',
          },
        });
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests: formatRequests },
      });

      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      console.log(`[Snapshot Sheet] Created and written: ${spreadsheetUrl}`);
      return { success: true, spreadsheetUrl };

    } else {
      // ── 2回目以降: 既存シートに列を追加 ─────────────────────────
      const sheetId = existingSheet.properties.sheetId;

      // 現在のヘッダー行を読んで次の列番号を確認
      const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!1:1`,
      });
      const headerRow = (headerRes.data.values || [[]])[0] || [];
      const nextColIndex = headerRow.length; // 0-indexed → 列インデックス
      const nextColLetter = columnIndexToLetter(nextColIndex);

      // 既にこの日付のデータがあればスキップ
      if (headerRow.includes(snapshotLabel)) {
        console.log(`[Snapshot Sheet] ${snapshotLabel} already exists in header, skipping`);
        return {
          success: true,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        };
      }

      // ヘッダーに日付を追記
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!${nextColLetter}1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[snapshotLabel]] },
      });

      // 既存のA列のTutor名の並び順を読み取り、sheetDataと照合して値を並べる
      const tutorColRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A2:A${dataRowCount + 1}`,
      });
      const tutorColValues = (tutorColRes.data.values || []).map(r => r[0] || '');

      // sheetData をマップ化 (tutorName -> { satisfactionValue, collectionRate, satisfactionScore })
      const dataMap = {};
      for (const d of sheetData) {
        dataMap[d.tutorName] = d;
      }

      // 既存シートの行順に合わせてデータを構築
      // 3行単位でTutor名が入っている行 (行インデックス 0, 3, 6, ...) がTutor名行
      const newColValues = [];
      for (let row = 0; row < tutorColValues.length; row++) {
        const tutorName = tutorColValues[row]; // 結合されていない行は空文字
        const groupIdx  = Math.floor(row / 3); // 何番目のTutorか (0-indexed)
        const itemIdx   = row % 3;             // 0=満足度, 1=回収率, 2=満足度スコア

        // 結合セルはAPIでは先頭行にしか値が入らない → groupIdx行目のTutor名で特定
        // 先頭行 (itemIdx===0) のときだけTutor名が読める
        // tutorColValues全体を先頭行だけ取り出してgroupIdxでマッピング
        // ※ セル結合があるため空文字行は同じTutor名として扱う
        // => まずgroup先頭のTutor名を別途取得する
        if (itemIdx === 0) {
          // このgroupのTutor名はtutorColValues[row]
          const d = dataMap[tutorName] || {};
          newColValues.push([d.satisfactionValue !== undefined ? d.satisfactionValue : '']);
        } else if (itemIdx === 1) {
          // 前のgroupのTutor名を使う (同じgroupなのでrow-1がTutor名行)
          const headTutorName = tutorColValues[row - 1];
          const d = dataMap[headTutorName] || {};
          newColValues.push([d.collectionRate !== undefined ? d.collectionRate : '']);
        } else {
          // itemIdx === 2
          const headTutorName = tutorColValues[row - 2];
          const d = dataMap[headTutorName] || {};
          newColValues.push([d.satisfactionScore !== undefined ? d.satisfactionScore : '']);
        }
      }

      if (newColValues.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${sheetName}'!${nextColLetter}2`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: newColValues },
        });
      }

      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      console.log(`[Snapshot Sheet] Appended column ${nextColLetter} (${snapshotLabel}): ${spreadsheetUrl}`);
      return { success: true, spreadsheetUrl };
    }

  } catch (error) {
    console.error('[Snapshot Sheet] Error exporting to sheet:', error);
    return { success: false, error: error.message };
  }
}

// 列インデックス (0始まり) → 列文字 (A, B, ..., Z, AA, ...)
function columnIndexToLetter(index) {
  let letter = '';
  let i = index;
  while (i >= 0) {
    letter = String.fromCharCode((i % 26) + 65) + letter;
    i = Math.floor(i / 26) - 1;
  }
  return letter;
}
