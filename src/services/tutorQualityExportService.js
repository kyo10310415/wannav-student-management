import { google } from 'googleapis';
import { query } from '../db/connection.js';
import {
  MINUTES_QUALITY_METRICS,
  aggregateMinutesQualityEvaluations
} from './minutesQualityService.js';

export const TUTOR_QUALITY_SHEET_NAME = 'Tutor品質評価';

export const TUTOR_QUALITY_EXPORT_HEADERS = [
  '対象月',
  '出力日時',
  '区分',
  'Tutor番号',
  'Tutor名',
  '総合平均',
  '議事録数',
  '厳格評価済み',
  '厳格評価前・未評価',
  '旧判定（集計対象外）',
  ...MINUTES_QUALITY_METRICS.map(metric => metric.monthlyLabel)
];

function normalizeIdentifier(value) {
  return String(value || '').trim().toLocaleLowerCase('ja-JP');
}

function buildUniqueTutorIdentifierMap(tutors) {
  const identifierMap = new Map();

  for (const tutor of tutors) {
    const identifiers = [tutor.tutor_name, tutor.notion_name, tutor.name, tutor.email]
      .map(normalizeIdentifier)
      .filter(Boolean);

    for (const identifier of identifiers) {
      if (!identifierMap.has(identifier)) {
        identifierMap.set(identifier, tutor.employee_id);
      } else if (identifierMap.get(identifier) !== tutor.employee_id) {
        // 同じ識別子を複数Tutorが持つ場合は誤集計を避けるため名前では紐付けない。
        identifierMap.set(identifier, null);
      }
    }
  }

  return identifierMap;
}

function averageMetricRates(summary) {
  const rates = summary.metrics
    .map(metric => metric.rate)
    .filter(rate => rate !== null);

  if (rates.length === 0) return null;
  return rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
}

/**
 * 画面と同じ品質評価集計を、全体とTutorごとに作る。
 * 「全体」はTutor平均の単純平均ではなく、Tutorに紐付いた全議事録を再集計する。
 */
export function buildTutorQualitySnapshot(tutors, minutes) {
  const activeTutors = tutors || [];
  const employeeMap = new Map(activeTutors.map(tutor => [tutor.employee_id, tutor]));
  const identifierMap = buildUniqueTutorIdentifierMap(activeTutors);
  const minutesByTutor = new Map(activeTutors.map(tutor => [tutor.employee_id, []]));
  const assignedMinutes = [];

  for (const minute of minutes || []) {
    let employeeId = employeeMap.has(minute.tutor_employee_id)
      ? minute.tutor_employee_id
      : null;

    if (!employeeId && !minute.tutor_employee_id) {
      employeeId = identifierMap.get(normalizeIdentifier(minute.tutor_name)) || null;
    }

    if (!employeeId) continue;
    minutesByTutor.get(employeeId).push(minute);
    assignedMinutes.push(minute);
  }

  const overall = aggregateMinutesQualityEvaluations(assignedMinutes);
  const tutorSummaries = activeTutors.map(tutor => {
    const summary = aggregateMinutesQualityEvaluations(
      minutesByTutor.get(tutor.employee_id) || []
    );
    return {
      employeeId: tutor.employee_id,
      tutorName: tutor.tutor_name || tutor.name || tutor.notion_name || tutor.email || '',
      overallAverage: averageMetricRates(summary),
      ...summary
    };
  });

  return {
    overall: {
      overallAverage: averageMetricRates(overall),
      ...overall
    },
    tutors: tutorSummaries,
    unassignedMinutes: (minutes || []).length - assignedMinutes.length
  };
}

function roundRate(value) {
  return value === null ? '' : Math.round(value * 100) / 100;
}

function formatJstDateTime(date) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}/${values.month}/${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function summaryToRow({ yearMonth, exportedAt, category, employeeId = '', tutorName = '', summary }) {
  const metricRates = MINUTES_QUALITY_METRICS.map(definition => {
    const metric = summary.metrics.find(item => item.key === definition.key);
    return roundRate(metric?.rate ?? null);
  });

  return [
    yearMonth,
    exportedAt,
    category,
    employeeId,
    tutorName,
    roundRate(summary.overallAverage),
    summary.totalMinutes,
    summary.evaluatedMinutes,
    summary.missingEvaluationMinutes,
    summary.legacyEvaluationMinutes,
    ...metricRates
  ];
}

export function buildTutorQualityExportRows(snapshot, year, month, exportedAt = new Date()) {
  const yearMonth = `${year}/${month}`;
  const exportedAtText = formatJstDateTime(exportedAt);

  return [
    summaryToRow({
      yearMonth,
      exportedAt: exportedAtText,
      category: '全体平均',
      summary: snapshot.overall
    }),
    ...snapshot.tutors.map(tutor => summaryToRow({
      yearMonth,
      exportedAt: exportedAtText,
      category: 'Tutor平均',
      employeeId: tutor.employeeId,
      tutorName: tutor.tutorName,
      summary: tutor
    }))
  ];
}

function parseGoogleCredentials() {
  const credentialText = process.env.GOOGLE_CREDENTIALS_JSON?.trim();
  if (!credentialText) {
    throw new Error('GOOGLE_CREDENTIALS_JSON not configured');
  }

  try {
    return credentialText.startsWith('{')
      ? JSON.parse(credentialText)
      : JSON.parse(Buffer.from(credentialText, 'base64').toString('utf-8'));
  } catch {
    throw new Error('Invalid GOOGLE_CREDENTIALS_JSON format');
  }
}

async function createSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: parseGoogleCredentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

async function ensureQualitySheet(sheets, spreadsheetId) {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheet = metadata.data.sheets?.find(
    sheet => sheet.properties?.title === TUTOR_QUALITY_SHEET_NAME
  );

  if (existingSheet) return existingSheet.properties.sheetId;

  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [{
        addSheet: {
          properties: {
            title: TUTOR_QUALITY_SHEET_NAME,
            gridProperties: {
              rowCount: 1000,
              columnCount: TUTOR_QUALITY_EXPORT_HEADERS.length
            }
          }
        }
      }]
    }
  });

  return response.data.replies[0].addSheet.properties.sheetId;
}

async function ensureQualitySheetHeader(sheets, spreadsheetId, sheetId) {
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TUTOR_QUALITY_SHEET_NAME}'!A1:P1`
  });
  const existingHeader = headerResponse.data.values?.[0] || [];

  if (existingHeader.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${TUTOR_QUALITY_SHEET_NAME}'!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [TUTOR_QUALITY_EXPORT_HEADERS] }
    });
  } else if (
    existingHeader.length !== TUTOR_QUALITY_EXPORT_HEADERS.length
    || existingHeader.some((value, index) => value !== TUTOR_QUALITY_EXPORT_HEADERS[index])
  ) {
    throw new Error(`既存の「${TUTOR_QUALITY_SHEET_NAME}」シートの見出しが想定形式と異なります`);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: { frozenRowCount: 1 }
            },
            fields: 'gridProperties.frozenRowCount'
          }
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.85, green: 0.94, blue: 0.97 },
                textFormat: { bold: true }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 5,
              endColumnIndex: 6
            },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'NUMBER', pattern: '0.00"%"' }
              }
            },
            fields: 'userEnteredFormat.numberFormat'
          }
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 10,
              endColumnIndex: TUTOR_QUALITY_EXPORT_HEADERS.length
            },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'NUMBER', pattern: '0.00"%"' }
              }
            },
            fields: 'userEnteredFormat.numberFormat'
          }
        }
      ]
    }
  });
}

/** 選択月の品質評価を集計し、専用シートへスナップショットとして追記する。 */
export async function exportTutorQualitySnapshot(year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const [tutorsResult, minutesResult] = await Promise.all([
    query(
      `SELECT employee_id, tutor_name, notion_name, name, email
         FROM tutors
        WHERE status = 'アクティブ'
          AND LOWER(job_type) LIKE '%tutor%'
        ORDER BY tutor_name ASC`
    ),
    query(
      `SELECT id, tutor_name, tutor_employee_id, quality_evaluation
         FROM minutes
        WHERE lesson_date >= $1::date
          AND lesson_date < $2::date`,
      [startDate, endDate]
    )
  ]);

  const snapshot = buildTutorQualitySnapshot(tutorsResult.rows, minutesResult.rows);
  const rows = buildTutorQualityExportRows(snapshot, year, month);
  const sheets = await createSheetsClient();
  const spreadsheetId = process.env.TUTOR_QUALITY_SHEET_ID
    || process.env.TUTOR_SATISFACTION_SHEET_ID
    || '1qlvFeFXYaA4Ul6R93qa7CiT4fdJHbrppUiI1tNl7bxg';
  const sheetId = await ensureQualitySheet(sheets, spreadsheetId);
  await ensureQualitySheetHeader(sheets, spreadsheetId, sheetId);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TUTOR_QUALITY_SHEET_NAME}'!A:P`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: rows }
  });

  return {
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
    sheetName: TUTOR_QUALITY_SHEET_NAME,
    year,
    month,
    tutorCount: snapshot.tutors.length,
    totalMinutes: snapshot.overall.totalMinutes,
    unassignedMinutes: snapshot.unassignedMinutes
  };
}
