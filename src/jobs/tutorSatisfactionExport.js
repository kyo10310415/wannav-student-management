import { query } from '../db/connection.js';
import { fetchSatisfactionFromCache } from '../services/cacheService.js';
import { getCompletedStudentIdsForMonth } from '../services/lessonCompletionService.js';
import {
  aggregateSatisfactionByTutorMonth,
  calculateSatisfactionMetricVariants,
  isLessonCompletionFilterActive
} from '../services/tutorSatisfactionService.js';
import { google } from 'googleapis';

export const MONTHLY_SATISFACTION_SHEET_NAMES = Object.freeze({
  legacy: 'Tutor満足度',
  lessonAdjusted: 'Tutor満足度（レッスン実施考慮）'
});

/**
 * Monthly tutor satisfaction export job.
 * Runs on the last day of each month at 23:00 JST.
 *
 * Existing sheet: legacy denominator (all eligible active students)
 * New sheet: lesson-adjusted denominator introduced by 6de382f
 */
export async function monthlyTutorSatisfactionExport() {
  try {
    console.log('[Tutor Satisfaction Export] Starting monthly satisfaction export...');

    const now = new Date();
    const jstOffset = 9 * 60;
    const jstTime = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000);
    const currentYear = jstTime.getFullYear();
    const currentMonth = jstTime.getMonth() + 1;
    const currentYearMonth = `${currentYear}/${currentMonth}`;

    console.log(`[Tutor Satisfaction Export] Exporting data for ${currentYearMonth}`);

    const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    const satisfactionRecords = await fetchSatisfactionFromCache(cacheSpreadsheetId);
    if (!satisfactionRecords || satisfactionRecords.length === 0) {
      console.log('[Tutor Satisfaction Export] No satisfaction data found');
      return { success: false, error: 'No satisfaction data' };
    }
    const satisfactionData = aggregateSatisfactionByTutorMonth(satisfactionRecords);

    const studentsResult = await query(
      'SELECT student_id, homeroom_tutor, status, contract_plan FROM students'
    );
    const students = studentsResult.rows;

    const tutorsResult = await query(`
      SELECT * FROM tutors
      WHERE status = 'アクティブ'
        AND LOWER(job_type) LIKE '%tutor%'
        AND tutor_name != 'きょうへい先生'
      ORDER BY tutor_name ASC
    `);
    const tutors = tutorsResult.rows;
    console.log(`[Tutor Satisfaction Export] Found ${tutors.length} active tutors`);

    const completionFilterActive = isLessonCompletionFilterActive(
      currentYear,
      currentMonth,
      now
    );
    let completedStudentIds = null;
    let lessonAdjustedCalculationAvailable = true;
    if (completionFilterActive) {
      try {
        const completion = await getCompletedStudentIdsForMonth(
          `${currentYear}-${String(currentMonth).padStart(2, '0')}`
        );
        completedStudentIds = new Set(completion.completedStudentIds);
      } catch (error) {
        lessonAdjustedCalculationAvailable = false;
        console.error(
          '[Tutor Satisfaction Export] Lesson completion filter unavailable:',
          error.message
        );
      }
    }

    const legacyRows = [];
    const lessonAdjustedRows = [];

    for (const tutor of tutors) {
      const tutorName = tutor.tutor_name;
      const monthData = (satisfactionData[tutorName] || {})[currentYearMonth];

      if (!monthData) {
        console.log(
          `[Tutor Satisfaction Export] No data for ${tutorName} in ${currentYearMonth}`
        );
        legacyRows.push(...emptyTutorRows(tutorName));
        lessonAdjustedRows.push(...emptyTutorRows(tutorName));
        continue;
      }

      const variants = calculateSatisfactionMetricVariants({
        monthData,
        students,
        tutor,
        year: currentYear,
        month: currentMonth,
        completedStudentIds,
        referenceDate: now
      });

      legacyRows.push(...metricsToTutorRows(tutorName, variants.legacy));
      lessonAdjustedRows.push(
        ...metricsToTutorRows(tutorName, variants.lessonAdjusted)
      );
    }

    if (legacyRows.length === 0) {
      console.log('[Tutor Satisfaction Export] No data to export');
      return { success: false, error: 'No data to export' };
    }

    const sheetContext = await createSheetContext();
    if (!sheetContext.success) return sheetContext;

    const legacyResult = await exportMonthlyRowsToSheet({
      ...sheetContext,
      sheetName: MONTHLY_SATISFACTION_SHEET_NAMES.legacy,
      yearMonth: currentYearMonth,
      rows: legacyRows
    });
    const lessonAdjustedResult = lessonAdjustedCalculationAvailable
      ? await exportMonthlyRowsToSheet({
        ...sheetContext,
        sheetName: MONTHLY_SATISFACTION_SHEET_NAMES.lessonAdjusted,
        yearMonth: currentYearMonth,
        rows: lessonAdjustedRows
      })
      : {
        success: false,
        error: 'Lesson completion data unavailable; adjusted snapshot was not written'
      };

    const success = legacyResult.success && lessonAdjustedResult.success;
    if (success) {
      console.log(
        `[Tutor Satisfaction Export] Both sheet exports complete: ${legacyResult.spreadsheetUrl}`
      );
    } else {
      console.warn('[Tutor Satisfaction Export] One or more sheet exports failed:', {
        legacy: legacyResult.error || null,
        lessonAdjusted: lessonAdjustedResult.error || null
      });
    }

    return {
      success,
      spreadsheetUrl: legacyResult.spreadsheetUrl
        || lessonAdjustedResult.spreadsheetUrl
        || null,
      sheetName: MONTHLY_SATISFACTION_SHEET_NAMES.legacy,
      lessonAdjustedSheetName: MONTHLY_SATISFACTION_SHEET_NAMES.lessonAdjusted,
      month: currentYearMonth,
      tutorCount: tutors.length,
      sheets: {
        legacy: {
          name: MONTHLY_SATISFACTION_SHEET_NAMES.legacy,
          ...legacyResult
        },
        lessonAdjusted: {
          name: MONTHLY_SATISFACTION_SHEET_NAMES.lessonAdjusted,
          ...lessonAdjustedResult
        }
      }
    };
  } catch (error) {
    console.error('[Tutor Satisfaction Export] Error during monthly export:', error);
    return { success: false, error: error.message };
  }
}

function emptyTutorRows(tutorName) {
  return [
    [tutorName, 'レッスン満足度', ''],
    ['', '回収率', ''],
    ['', '満足度スコア', '']
  ];
}

function metricsToTutorRows(tutorName, metrics) {
  return [
    [tutorName, 'レッスン満足度', metrics.satisfactionValue.toFixed(2)],
    [
      '',
      '回収率',
      metrics.collectionRate !== null ? metrics.collectionRate.toFixed(2) : '-'
    ],
    [
      '',
      '満足度スコア',
      metrics.satisfactionScore !== null && metrics.satisfactionScore > 0
        ? metrics.satisfactionScore.toFixed(2)
        : '-'
    ]
  ];
}

async function createSheetContext() {
  if (!process.env.GOOGLE_CREDENTIALS_JSON) {
    console.error('[Tutor Satisfaction Export] GOOGLE_CREDENTIALS_JSON not set');
    return { success: false, error: 'GOOGLE_CREDENTIALS_JSON not configured' };
  }

  const credString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
  let credentials;
  try {
    credentials = credString.startsWith('{')
      ? JSON.parse(credString)
      : JSON.parse(Buffer.from(credString, 'base64').toString('utf-8'));
  } catch (error) {
    console.error('[Tutor Satisfaction Export] Failed to parse credentials:', error.message);
    return { success: false, error: 'Invalid credentials format' };
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const authClient = await auth.getClient();
  return {
    success: true,
    sheets: google.sheets({ version: 'v4', auth: authClient }),
    spreadsheetId: process.env.TUTOR_SATISFACTION_SHEET_ID
      || '1qlvFeFXYaA4Ul6R93qa7CiT4fdJHbrppUiI1tNl7bxg'
  };
}

async function exportMonthlyRowsToSheet({
  sheets,
  spreadsheetId,
  sheetName,
  yearMonth,
  rows
}) {
  try {
    const spreadsheetMetadata = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = spreadsheetMetadata.data.sheets.find(
      sheet => sheet.properties.title === sheetName
    );
    let sheetId;

    if (!existingSheet) {
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: {
                  rowCount: rows.length + 10,
                  columnCount: 50
                }
              }
            }
          }]
        }
      });
      sheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;

      const allRows = [['Tutor名', '項目', yearMonth], ...rows];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: allRows }
      });

      const mergeRequests = [];
      for (let rowIndex = 1; rowIndex < allRows.length; rowIndex += 3) {
        mergeRequests.push({
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: rowIndex,
              endRowIndex: Math.min(rowIndex + 3, allRows.length),
              startColumnIndex: 0,
              endColumnIndex: 1
            },
            mergeType: 'MERGE_ALL'
          }
        });
      }
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 }
                },
                fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'
              }
            },
            ...mergeRequests
          ]
        }
      });
      console.log(`[Tutor Satisfaction Export] Created ${sheetName} for ${yearMonth}`);
    } else {
      sheetId = existingSheet.properties.sheetId;
      const headerResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A1:ZZ1`
      });
      const headerRow = headerResponse.data.values?.[0] || [];
      if (headerRow.includes(yearMonth)) {
        console.log(
          `[Tutor Satisfaction Export] ${yearMonth} already exists in ${sheetName}, skipping`
        );
        return {
          success: true,
          skipped: true,
          spreadsheetUrl: spreadsheetUrl(spreadsheetId, sheetId)
        };
      }

      const nextColumnLetter = getColumnLetter(headerRow.length);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!${nextColumnLetter}1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[yearMonth]] }
      });

      const existingTutorResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A2:B1000`
      });
      const existingRows = existingTutorResponse.data.values || [];
      const updateData = [];
      for (let index = 0; index < existingRows.length; index += 3) {
        const tutorName = existingRows[index]?.[0] || '';
        const tutorRowIndex = rows.findIndex(row => row[0] === tutorName);
        if (tutorRowIndex >= 0) {
          updateData.push([rows[tutorRowIndex][2]]);
          updateData.push([rows[tutorRowIndex + 1][2]]);
          updateData.push([rows[tutorRowIndex + 2][2]]);
        } else {
          updateData.push([''], [''], ['']);
        }
      }

      if (updateData.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${sheetName}'!${nextColumnLetter}2`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: updateData }
        });
      }
      console.log(`[Tutor Satisfaction Export] Appended ${yearMonth} to ${sheetName}`);
    }

    return {
      success: true,
      spreadsheetUrl: spreadsheetUrl(spreadsheetId, sheetId)
    };
  } catch (error) {
    console.error(`[Tutor Satisfaction Export] Failed to export ${sheetName}:`, error);
    return { success: false, error: error.message };
  }
}

function spreadsheetUrl(spreadsheetId, sheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;
}

function getColumnLetter(index) {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}
