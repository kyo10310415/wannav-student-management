import { query } from '../db/connection.js';
import { fetchSatisfactionFromCache } from '../services/cacheService.js';
import { getCompletedStudentIdsForMonth } from '../services/lessonCompletionService.js';
import {
  aggregateSatisfactionByTutorMonth,
  calculateSatisfactionMetrics,
  getSatisfactionDenominator,
  isLessonCompletionFilterActive
} from '../services/tutorSatisfactionService.js';
import { google } from 'googleapis';

/**
 * Tutorスナップショットジョブ
 *
 * 週次: 毎週日曜日 23:59 JST — weeklyTutorSnapshot()
 * 月次: 毎月末日   23:30 JST — monthlyTutorSnapshot()
 *
 * 書き出し先（シート名固定・1シート蓄積）:
 *   週次 → 「週次スナップショット」
 *   月次 → 「月次スナップショット」
 *
 * レイアウト:
 *   1行目: Tutor名 | 項目 | MM/DD or YYYY/M | ...
 *   以降: TutorA | 満足度 | 値 | ...
 *         (結合)  | 回収率 | 値 | ...
 *         (結合)  | 満足度スコア | 値 | ...
 *   末尾: 全体 | 満足度（平均） | 値 | ...
 *         (結合) | 回収率（回答数・分母数による加重） | 値 | ...
 *         (結合) | 満足度スコア | 値 | ...
 */

// ─── 公開エントリポイント ─────────────────────────────────────────────────────

/** 週次スナップショット（毎週日曜 23:59 JST） */
export async function weeklyTutorSnapshot() {
  return _runSnapshot({ isMonthly: false });
}

/** 月次スナップショット（毎月末日 23:30 JST） */
export async function monthlyTutorSnapshot() {
  return _runSnapshot({ isMonthly: true });
}

// ─── 共通実装 ─────────────────────────────────────────────────────────────────

async function _runSnapshot({ isMonthly }) {
  const label = isMonthly ? 'Monthly' : 'Weekly';
  try {
    console.log(`[Tutor ${label} Snapshot] Starting...`);

    // JST現在時刻
    const now = new Date();
    const jstOffset = 9 * 60;
    const jst = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000);

    const snapshotYear  = jst.getFullYear();
    const snapshotMonth = jst.getMonth() + 1;
    const snapshotDay   = jst.getDate();
    const snapshotDate  = `${snapshotYear}-${String(snapshotMonth).padStart(2, '0')}-${String(snapshotDay).padStart(2, '0')}`;

    // 列ヘッダーラベル
    // 週次: "5/18"  月次: "2026/7"
    const snapshotLabel = isMonthly
      ? `${snapshotYear}/${snapshotMonth}`
      : `${snapshotMonth}/${snapshotDay}`;

    const yearMonth = `${snapshotYear}/${snapshotMonth}`;

    console.log(`[Tutor ${label} Snapshot] date=${snapshotDate}, label=${snapshotLabel}`);

    // 満足度データ取得
    const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    const satisfactionRaw = await fetchSatisfactionFromCache(cacheSpreadsheetId);

    const satisfactionByTutor = aggregateSatisfactionByTutorMonth(satisfactionRaw);

    // アクティブTutor
    const tutorsResult = await query(`
      SELECT * FROM tutors
      WHERE status = 'アクティブ'
        AND LOWER(job_type) LIKE '%tutor%'
        AND tutor_name != 'きょうへい先生'
      ORDER BY tutor_name ASC
    `);
    const tutors = tutorsResult.rows;

    // 生徒
    const studentsResult = await query(
      `SELECT student_id, homeroom_tutor, status, contract_plan FROM students`
    );
    const students = studentsResult.rows;

    let completedStudentIds = null;
    if (isLessonCompletionFilterActive(snapshotYear, snapshotMonth, now)) {
      try {
        const completion = await getCompletedStudentIdsForMonth(
          `${snapshotYear}-${String(snapshotMonth).padStart(2, '0')}`
        );
        completedStudentIds = new Set(completion.completedStudentIds);
      } catch (error) {
        console.error(`[Tutor ${label} Snapshot] Lesson completion filter unavailable:`, error.message);
      }
    }

    // ─── 各Tutorのデータ計算 ─────────────────────────────────────────────
    let savedCount = 0, skippedCount = 0;
    const sheetData = []; // { tutorName, satisfactionValue, collectionRate, satisfactionScore }

    for (const tutor of tutors) {
      const satisfactionDenominator = getSatisfactionDenominator({
        students,
        tutor,
        year: snapshotYear,
        month: snapshotMonth,
        completedStudentIds,
        referenceDate: now
      });

      const monthData = (satisfactionByTutor[tutor.tutor_name] || {})[yearMonth];
      const satisfactionAvg = monthData ? monthData.average : null;
      const {
        satisfactionValue,
        satisfactionCount,
        collectionRate,
        satisfactionScore
      } = calculateSatisfactionMetrics(monthData, satisfactionDenominator);

      // 週次のみDBに保存
      if (!isMonthly) {
        try {
          await query(`
            INSERT INTO tutor_weekly_snapshots
              (snapshot_date, tutor_notion_name, year_month,
               active_student_count, satisfaction_count, satisfaction_avg,
               satisfaction_value, collection_rate, satisfaction_score)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
            snapshotDate, tutor.notion_name, yearMonth,
            satisfactionDenominator, satisfactionCount, satisfactionAvg,
            satisfactionValue, collectionRate, satisfactionScore
          ]);
          savedCount++;
        } catch (err) {
          console.error(`[Tutor ${label} Snapshot] DB error for ${tutor.notion_name}:`, err.message);
          skippedCount++;
        }
      }

      sheetData.push({
        tutorName:         tutor.tutor_name,
        satisfactionValue: satisfactionValue !== null ? parseFloat(satisfactionValue.toFixed(2)) : '',
        collectionRate:    collectionRate    !== null ? parseFloat(collectionRate.toFixed(2))    : '',
        satisfactionScore: satisfactionScore !== null ? parseFloat(satisfactionScore.toFixed(2)) : '',
        satisfactionCount,
        satisfactionDenominator,
      });
    }

    // ─── 全体集計行 ───────────────────────────────────────────────────────
    // 画面と同様、満足度データと有効な分母があるTutorだけを集計対象にする
    const validData = sheetData.filter(d =>
      d.satisfactionValue !== '' && d.satisfactionDenominator > 0
    );
    let overallSatisfactionValue = '';
    let overallCollectionRate    = '';
    let overallSatisfactionScore = '';

    if (validData.length > 0) {
      overallSatisfactionValue = parseFloat(
        (validData.reduce((s, d) => s + d.satisfactionValue, 0) / validData.length).toFixed(2)
      );
      const totalAnswers = validData.reduce((sum, data) => sum + data.satisfactionCount, 0);
      const totalDenominator = validData.reduce((sum, data) => sum + data.satisfactionDenominator, 0);
      if (totalDenominator > 0) {
        overallCollectionRate = parseFloat(
          (totalAnswers / totalDenominator * 100).toFixed(2)
        );
      }
      const validScore = validData.filter(d => d.satisfactionScore !== '');
      if (validScore.length > 0) {
        overallSatisfactionScore = parseFloat(
          (validScore.reduce((s, d) => s + d.satisfactionScore, 0) / validScore.length).toFixed(2)
        );
      }
    }

    // 全体行をsheetDataの末尾に追加
    const sheetDataWithOverall = [
      ...sheetData,
      {
        tutorName:         '全体',
        satisfactionValue: overallSatisfactionValue,
        collectionRate:    overallCollectionRate,
        satisfactionScore: overallSatisfactionScore,
      }
    ];

    if (!isMonthly) {
      console.log(`[Tutor ${label} Snapshot] DB done. saved=${savedCount}, skipped=${skippedCount}`);
    }

    // ─── スプレッドシートへの書き出し ─────────────────────────────────────
    const sheetName = isMonthly ? '月次スナップショット' : '週次スナップショット';
    const sheetResult = await exportSnapshotToSheet(
      sheetDataWithOverall, snapshotDate, snapshotLabel, sheetName
    );

    if (sheetResult.success) {
      console.log(`[Tutor ${label} Snapshot] Sheet export done: ${sheetResult.spreadsheetUrl}`);
    } else {
      console.warn(`[Tutor ${label} Snapshot] Sheet export failed: ${sheetResult.error}`);
    }

    return {
      success: true,
      savedCount,
      skippedCount,
      snapshotDate,
      sheetUrl: sheetResult.spreadsheetUrl || null,
    };

  } catch (error) {
    console.error(`[Tutor ${label} Snapshot] Fatal error:`, error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// スプレッドシートへの書き出し（シート名固定・1シート蓄積）
//
// sheetName: "週次スナップショット" or "月次スナップショット"
//
// レイアウト:
//   行1 (ヘッダー): Tutor名 | 項目 | 5/4 | 5/11 | ... (週次) or 2026/6 | ...（月次）
//   行2: TutorA    | 満足度       | 値   | ...
//   行3: (結合)    | 回収率       | 値   | ...
//   行4: (結合)    | 満足度スコア  | 値   | ...
//   ...
//   末尾3行: 全体 | 満足度 / 回収率 / 満足度スコア
//
// 初回: シートを新規作成してヘッダー + 全データを書き込む
// 以降: 最終列の右に新しい日付列を追加する
// ─────────────────────────────────────────────────────────────────────────────
async function exportSnapshotToSheet(sheetData, snapshotDate, snapshotLabel, sheetName) {
  try {
    if (!process.env.GOOGLE_CREDENTIALS_JSON) {
      console.warn('[Snapshot Sheet] GOOGLE_CREDENTIALS_JSON not set, skipping');
      return { success: false, error: 'GOOGLE_CREDENTIALS_JSON not configured' };
    }

    // Google認証
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

    // シート存在確認
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = meta.data.sheets.find(s => s.properties.title === sheetName);

    const tutorCount  = sheetData.length;               // 全体行を含む
    const dataRowCount = tutorCount * 3;

    if (!existingSheet) {
      // ── 初回: シート新規作成 ──────────────────────────────────────────
      console.log(`[Snapshot Sheet] Creating new sheet: "${sheetName}"`);

      const addRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: {
                  rowCount:    dataRowCount + 10,
                  columnCount: 60,
                },
              },
            },
          }],
        },
      });
      const newSheetId = addRes.data.replies[0].addSheet.properties.sheetId;

      // 書き込み内容を構築
      const headerRow = ['Tutor名', '項目', snapshotLabel];
      const rows = [headerRow];
      for (const d of sheetData) {
        rows.push([d.tutorName, '満足度',     d.satisfactionValue]);
        rows.push(['',          '回収率',      d.collectionRate]);
        rows.push(['',          '満足度スコア', d.satisfactionScore]);
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: rows },
      });

      // フォーマット: 1行・2列凍結 + Tutor名セル結合
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

      for (let i = 0; i < tutorCount; i++) {
        const startRow = 1 + i * 3;
        formatRequests.push({
          mergeCells: {
            range: {
              sheetId: newSheetId,
              startRowIndex:    startRow,
              endRowIndex:      startRow + 3,
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
      console.log(`[Snapshot Sheet] Created "${sheetName}": ${spreadsheetUrl}`);
      return { success: true, spreadsheetUrl };

    } else {
      // ── 2回目以降: 右端に列追加 ──────────────────────────────────────
      const sheetId = existingSheet.properties.sheetId;

      // ヘッダー行取得
      const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!1:1`,
      });
      const headerRow   = (headerRes.data.values || [[]])[0] || [];
      const nextColIdx  = headerRow.length;
      const nextColLetter = columnIndexToLetter(nextColIdx);

      // 同じラベルが既に存在するならスキップ
      if (headerRow.includes(snapshotLabel)) {
        console.log(`[Snapshot Sheet] "${snapshotLabel}" already exists in "${sheetName}", skipping`);
        return {
          success: true,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        };
      }

      // ヘッダーに日付追記
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!${nextColLetter}1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[snapshotLabel]] },
      });

      // A列のTutor名リストを取得（結合セルは先頭行にのみ値あり）
      const tutorColRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A2:A${dataRowCount + 1}`,
      });
      const tutorColValues = (tutorColRes.data.values || []).map(r => r[0] || '');

      // sheetData をマップ化
      const dataMap = {};
      for (const d of sheetData) {
        dataMap[d.tutorName] = d;
      }

      // 既存シートの行順にデータを並べる
      const newColValues = [];
      let currentTutorName = '';
      for (let row = 0; row < tutorColValues.length; row++) {
        const itemIdx = row % 3;
        if (itemIdx === 0 && tutorColValues[row]) {
          currentTutorName = tutorColValues[row];
        }
        const d = dataMap[currentTutorName] || {};
        if (itemIdx === 0)      newColValues.push([d.satisfactionValue !== undefined ? d.satisfactionValue : '']);
        else if (itemIdx === 1) newColValues.push([d.collectionRate    !== undefined ? d.collectionRate    : '']);
        else                    newColValues.push([d.satisfactionScore !== undefined ? d.satisfactionScore : '']);
      }

      if (newColValues.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${sheetName}'!${nextColLetter}2`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: newColValues },
        });
      }

      // シートの行数が足りない場合（新しいTutorが増えた場合）に末尾を追記
      const existingRowCount = tutorColValues.length;
      if (dataRowCount > existingRowCount) {
        const extraStart = existingRowCount + 2; // 1-indexed (ヘッダー + 既存データの次)
        const extraRows  = [];
        for (let i = existingRowCount / 3; i < tutorCount; i++) {
          const d = sheetData[i];
          extraRows.push([d.tutorName, '満足度',     d.satisfactionValue]);
          extraRows.push(['',          '回収率',      d.collectionRate]);
          extraRows.push(['',          '満足度スコア', d.satisfactionScore]);
        }
        if (extraRows.length > 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${sheetName}'!A${extraStart}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: extraRows },
          });
          // 新規追加Tutorのセル結合
          const mergeRequests = [];
          for (let i = existingRowCount / 3; i < tutorCount; i++) {
            const startRow = 1 + i * 3;
            mergeRequests.push({
              mergeCells: {
                range: {
                  sheetId,
                  startRowIndex:    startRow,
                  endRowIndex:      startRow + 3,
                  startColumnIndex: 0,
                  endColumnIndex:   1,
                },
                mergeType: 'MERGE_ALL',
              },
            });
          }
          if (mergeRequests.length > 0) {
            await sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              resource: { requests: mergeRequests },
            });
          }
        }
      }

      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      console.log(`[Snapshot Sheet] Appended col ${nextColLetter} ("${snapshotLabel}") to "${sheetName}": ${spreadsheetUrl}`);
      return { success: true, spreadsheetUrl };
    }

  } catch (error) {
    console.error('[Snapshot Sheet] Error:', error);
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
