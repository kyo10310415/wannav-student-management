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
 * Monthly tutor satisfaction export job
 * Runs on the last day of each month at 23:00 JST to export current month's satisfaction data
 */
export async function monthlyTutorSatisfactionExport() {
  try {
    console.log('[Tutor Satisfaction Export] Starting monthly satisfaction export...');
    
    const now = new Date();
    const jstOffset = 9 * 60; // JST is UTC+9
    const jstTime = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000);
    
    // Calculate current month (not previous month)
    const currentYear = jstTime.getFullYear();
    const currentMonth = jstTime.getMonth() + 1;
    const currentYearMonth = `${currentYear}/${currentMonth}`;
    
    console.log(`[Tutor Satisfaction Export] Exporting data for ${currentYearMonth} (current month)`);
    
    // 1. Fetch satisfaction data from cache
    const cacheSpreadsheetId = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    const satisfactionRecords = await fetchSatisfactionFromCache(cacheSpreadsheetId);
    
    if (!satisfactionRecords || satisfactionRecords.length === 0) {
      console.log('[Tutor Satisfaction Export] No satisfaction data found');
      return { success: false, error: 'No satisfaction data' };
    }
    const satisfactionData = aggregateSatisfactionByTutorMonth(satisfactionRecords);
    
    // 2. Fetch students for active student count calculation
    const studentsResult = await query('SELECT * FROM students');
    const students = studentsResult.rows;
    
    // 3. Fetch active tutors (case-insensitive check for job_type)
    const tutorsResult = await query(`
      SELECT * FROM tutors 
      WHERE status = 'アクティブ' 
        AND LOWER(job_type) LIKE '%tutor%'
        AND tutor_name != 'きょうへい先生'
      ORDER BY tutor_name ASC
    `);
    const tutors = tutorsResult.rows;
    
    console.log(`[Tutor Satisfaction Export] Found ${tutors.length} active tutors`);

    let completedStudentIds = null;
    if (isLessonCompletionFilterActive(currentYear, currentMonth, now)) {
      try {
        const completion = await getCompletedStudentIdsForMonth(
          `${currentYear}-${String(currentMonth).padStart(2, '0')}`
        );
        completedStudentIds = new Set(completion.completedStudentIds);
      } catch (error) {
        console.error('[Tutor Satisfaction Export] Lesson completion filter unavailable:', error.message);
      }
    }
    
    // 4. Prepare data for the current month
    const rows = [];
    
    tutors.forEach(tutor => {
      const tutorName = tutor.tutor_name;
      const tutorSatisfactionData = satisfactionData[tutorName] || {};
      const monthData = tutorSatisfactionData[currentYearMonth];
      
      if (!monthData) {
        console.log(`[Tutor Satisfaction Export] No data for ${tutorName} in ${currentYearMonth}`);
        // Still add empty rows for this tutor to maintain structure
        rows.push([tutorName, 'レッスン満足度', '']);
        rows.push(['', '回収率', '']);
        rows.push(['', '満足度スコア', '']);
        return;
      }
      
      const activeStudentCount = getSatisfactionDenominator({
        students,
        tutor,
        year: currentYear,
        month: currentMonth,
        completedStudentIds,
        referenceDate: now
      });
      const metrics = calculateSatisfactionMetrics(monthData, activeStudentCount);
      
      // Row 1: レッスン満足度
      const satisfactionValueNumber = metrics.satisfactionValue;
      const satisfactionValue = satisfactionValueNumber.toFixed(2);
      rows.push([tutorName, 'レッスン満足度', satisfactionValue]);
      
      // Row 2: 回収率
      const collectionRate = metrics.collectionRate !== null
        ? metrics.collectionRate.toFixed(2)
        : '-';
      rows.push(['', '回収率', collectionRate]);
      
      // Row 3: 満足度スコア
      const satisfactionScore = metrics.satisfactionScore !== null && metrics.satisfactionScore > 0
        ? metrics.satisfactionScore.toFixed(2)
        : '-';
      rows.push(['', '満足度スコア', satisfactionScore]);
    });
    
    if (rows.length === 0) {
      console.log('[Tutor Satisfaction Export] No data to export');
      return { success: false, error: 'No data to export' };
    }
    
    // 5. Export to Google Spreadsheet
    const sheets = google.sheets('v4');
    
    if (!process.env.GOOGLE_CREDENTIALS_JSON) {
      console.error('[Tutor Satisfaction Export] GOOGLE_CREDENTIALS_JSON not set');
      return { success: false, error: 'GOOGLE_CREDENTIALS_JSON not configured' };
    }
    
    const credString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
    let credentials;
    
    // Try to parse as base64 first, then as plain JSON
    try {
      if (credString.startsWith('{')) {
        credentials = JSON.parse(credString);
      } else {
        credentials = JSON.parse(Buffer.from(credString, 'base64').toString('utf-8'));
      }
    } catch (parseError) {
      console.error('[Tutor Satisfaction Export] Failed to parse credentials:', parseError.message);
      return { success: false, error: 'Invalid credentials format' };
    }
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    const authClient = await auth.getClient();
    const spreadsheetId = process.env.TUTOR_SATISFACTION_SHEET_ID || '1qlvFeFXYaA4Ul6R93qa7CiT4fdJHbrppUiI1tNl7bxg';
    const sheetName = 'Tutor満足度';
    
    // Check if sheet exists
    const spreadsheetMetadata = await sheets.spreadsheets.get({
      auth: authClient,
      spreadsheetId
    });
    
    let sheetId;
    const existingSheet = spreadsheetMetadata.data.sheets.find(s => s.properties.title === sheetName);
    
    if (!existingSheet) {
      // Create new sheet if it doesn't exist
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        auth: authClient,
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
      
      // Write initial data (header + all rows)
      const headerRow = ['Tutor名', '項目', currentYearMonth];
      const allRows = [headerRow, ...rows];
      
      await sheets.spreadsheets.values.update({
        auth: authClient,
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: allRows
        }
      });
      
      // Apply initial formatting
      await sheets.spreadsheets.batchUpdate({
        auth: authClient,
        spreadsheetId,
        resource: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: {
                    frozenRowCount: 1,
                    frozenColumnCount: 2
                  }
                },
                fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'
              }
            }
          ]
        }
      });
      
      // Merge cells for tutor names
      const mergeRequests = [];
      for (let i = 1; i < allRows.length; i += 3) {
        mergeRequests.push({
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: i,
              endRowIndex: Math.min(i + 3, allRows.length),
              startColumnIndex: 0,
              endColumnIndex: 1
            },
            mergeType: 'MERGE_ALL'
          }
        });
      }
      
      if (mergeRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          auth: authClient,
          spreadsheetId,
          resource: {
            requests: mergeRequests
          }
        });
      }
      
      console.log(`[Tutor Satisfaction Export] Created new sheet ${sheetName} with initial data for ${currentYearMonth}`);
    } else {
      // Sheet exists, append new month's data
      sheetId = existingSheet.properties.sheetId;
      
      // Read existing data to find the next column
      const existingData = await sheets.spreadsheets.values.get({
        auth: authClient,
        spreadsheetId,
        range: `${sheetName}!A1:ZZ1`
      });
      
      const headerRow = existingData.data.values ? existingData.data.values[0] : [];
      const nextColumnIndex = headerRow.length;
      const nextColumnLetter = getColumnLetter(nextColumnIndex);
      
      // Check if the new month already exists
      if (headerRow.includes(currentYearMonth)) {
        console.log(`[Tutor Satisfaction Export] Month ${currentYearMonth} already exists in sheet, skipping`);
        return { success: true, message: `Month ${currentYearMonth} already exists` };
      }
      
      // Append new month header
      await sheets.spreadsheets.values.update({
        auth: authClient,
        spreadsheetId,
        range: `${sheetName}!${nextColumnLetter}1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[currentYearMonth]]
        }
      });
      
      // Read existing tutor names from column A
      const existingTutorData = await sheets.spreadsheets.values.get({
        auth: authClient,
        spreadsheetId,
        range: `${sheetName}!A2:B1000`
      });
      
      const existingRows = existingTutorData.data.values || [];
      
      // Match tutors and append data
      const updateData = [];
      
      for (let i = 0; i < existingRows.length; i += 3) {
        const tutorName = existingRows[i] ? existingRows[i][0] : '';
        
        // Find matching data for this tutor
        const tutorRowIndex = rows.findIndex(r => r[0] === tutorName);
        
        if (tutorRowIndex >= 0) {
          // Found matching tutor, add their 3 values
          updateData.push([rows[tutorRowIndex][2]]);       // レッスン満足度
          updateData.push([rows[tutorRowIndex + 1][2]]);   // 回収率
          updateData.push([rows[tutorRowIndex + 2][2]]);   // 満足度スコア
        } else {
          // No data for this tutor, add empty cells
          updateData.push(['']);
          updateData.push(['']);
          updateData.push(['']);
        }
      }
      
      if (updateData.length > 0) {
        await sheets.spreadsheets.values.update({
          auth: authClient,
          spreadsheetId,
          range: `${sheetName}!${nextColumnLetter}2`,
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: updateData
          }
        });
      }
      
      console.log(`[Tutor Satisfaction Export] Appended new month ${currentYearMonth} to ${sheetName}`);
    }
    
    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;
    
    console.log(`[Tutor Satisfaction Export] Export complete: ${spreadsheetUrl}`);
    
    return {
      success: true,
      spreadsheetUrl,
      sheetName,
      month: currentYearMonth,
      tutorCount: tutors.length
    };
  } catch (error) {
    console.error('[Tutor Satisfaction Export] Error during monthly export:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to convert column index to letter (0 -> A, 1 -> B, ..., 25 -> Z, 26 -> AA, ...)
function getColumnLetter(index) {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}
