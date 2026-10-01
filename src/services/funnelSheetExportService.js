import { getSheets } from './sheetsService.js';
import { fetchFunnelDataForMonth } from './funnelDataService.js';

export const FUNNEL_SNAPSHOT_SPREADSHEET_ID =
  process.env.FUNNEL_SNAPSHOT_SPREADSHEET_ID ||
  '1IWYAxEN8XusegHC7IJidPOKobnqhG3wL-FR0LkWPCuY';

function valueOrBlank(value) {
  return value === null || value === undefined ? '' : value;
}

function metricRows(prefix, metric) {
  return [
    [`${prefix}｜分子`, valueOrBlank(metric?.numerator)],
    [`${prefix}｜分母`, valueOrBlank(metric?.denominator)],
    [`${prefix}｜率（%）`, valueOrBlank(metric?.rate)]
  ];
}

function tutorRows(tutor) {
  const prefix = `担当Tutor別｜${tutor.name}`;
  return [
    [`${prefix}｜対象生徒数`, valueOrBlank(tutor.metrics?.denominator)],
    ...metricRows(`${prefix}｜お支払い完了`, tutor.metrics?.payment),
    ...metricRows(`${prefix}｜レッスン予約`, tutor.metrics?.reservation),
    ...metricRows(`${prefix}｜レッスン実施`, tutor.metrics?.completion),
    ...metricRows(`${prefix}｜アンケート回答`, tutor.metrics?.survey),
    ...metricRows(`${prefix}｜レッスン実施者のアンケート回答`, tutor.metrics?.surveyAmongCompleted)
  ];
}

/** ファネル画面の集計結果を、月を列として保存できる行形式へ変換する。 */
export function buildFunnelSnapshotRows(data) {
  const overall = data?.overall || {};
  const attrition = data?.attrition || {};
  const cancellation = data?.cancellationBreakdown || {};
  const unavailable = cancellation.unavailable || {};
  const rows = [
    ['生徒様全体｜対象生徒数', valueOrBlank(overall.denominator)],
    ...metricRows('生徒様全体｜お支払い完了', overall.payment),
    ...metricRows('生徒様全体｜レッスン予約', overall.reservation),
    ...metricRows('生徒様全体｜レッスン実施', overall.completion),
    ...metricRows('生徒様全体｜アンケート回答', overall.survey),
    ...metricRows('生徒様全体｜レッスン実施者のアンケート回答', overall.surveyAmongCompleted),
    ['離脱分析｜5カ月到達者数', valueOrBlank(attrition.cohortCount)],
    ...metricRows('離脱分析｜5カ月累積離脱', attrition.cumulativeFiveMonth),
    ...((attrition.months || []).flatMap(item =>
      metricRows(`離脱分析｜${item.month}カ月目離脱`, item)
    )),
    ['離脱分析｜状態的離脱数', valueOrBlank(attrition.statusAttritionCount)],
    ['レッスン未受講の内訳｜レッスン未受講総数', valueOrBlank(cancellation.lessonNotAttendedTotal)],
    ['レッスン未受講の内訳｜実施済み', valueOrBlank(cancellation.completed)],
    ['レッスン未受講の内訳｜予約済み未受講数', valueOrBlank(cancellation.bookedNotAttended)],
    ['レッスン未受講の内訳｜事前キャンセル', valueOrBlank(cancellation.studentReschedule)],
    ['レッスン未受講の内訳｜再予約し受講', valueOrBlank(unavailable.rebookedAndCompleted)],
    ['レッスン未受講の内訳｜再予約し再キャンセル', valueOrBlank(unavailable.rebookedAndCancelled)],
    ['レッスン未受講の内訳｜再予約済み・結果未確定', valueOrBlank(unavailable.rebookingPending)],
    ['レッスン未受講の内訳｜再予約なし', valueOrBlank(unavailable.noRebooking)],
    ['レッスン未受講の内訳｜連絡なしキャンセル', valueOrBlank(cancellation.noShow)],
    ['レッスン未受講の内訳｜後日連絡あり', valueOrBlank(unavailable.contactedLater)],
    ['レッスン未受講の内訳｜連絡なしでそのまま無断キャンセル', valueOrBlank(unavailable.noContactAfterNoShow)],
    ['レッスン未受講の内訳｜7日間確認中', valueOrBlank(unavailable.followupPending)],
    ['レッスン未受講の内訳｜Tutorからのリマインド', valueOrBlank(unavailable.tutorReminderSent)],
    ['レッスン未受講の内訳｜先生都合キャンセル', valueOrBlank(cancellation.tutorReschedule)],
    ['レッスン未受講の内訳｜その他', valueOrBlank(cancellation.other)],
    ['レッスン未受講の内訳｜未予約数', valueOrBlank(cancellation.unreservedCount)],
    ['レッスン未受講の内訳｜予約リンク未送付', valueOrBlank(unavailable.bookingLinkNotSent)],
    ['レッスン未受講の内訳｜予約リンク送付', valueOrBlank(unavailable.bookingLinkSent)],
    ['レッスン未受講の内訳｜Discord判定エラー数', valueOrBlank(unavailable.discordErrorCount)]
  ];

  for (const tutor of data?.tutors || []) rows.push(...tutorRows(tutor));
  return rows;
}

export function formatSnapshotYearMonth(year, month) {
  return `${Number(year)}/${String(Number(month)).padStart(2, '0')}`;
}

export function columnIndexToLetter(index) {
  let value = Number(index);
  let result = '';
  while (value >= 0) {
    result = String.fromCharCode((value % 26) + 65) + result;
    value = Math.floor(value / 26) - 1;
  }
  return result;
}

function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

async function resolveSheet(sheets, spreadsheetId) {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const allSheets = metadata.data.sheets || [];
  const configuredName = process.env.FUNNEL_SNAPSHOT_SHEET_NAME?.trim();
  const selected = configuredName
    ? allSheets.find(sheet => sheet.properties?.title === configuredName)
    : allSheets[0];
  if (!selected) {
    throw new Error(configuredName
      ? `出力先シート「${configuredName}」が見つかりません`
      : '出力先スプレッドシートにシートがありません');
  }
  return selected.properties;
}

async function ensureGridSize(sheets, spreadsheetId, properties, rowCount, columnCount) {
  const requests = [];
  if (properties.gridProperties.rowCount < rowCount) {
    requests.push({
      appendDimension: {
        sheetId: properties.sheetId,
        dimension: 'ROWS',
        length: rowCount - properties.gridProperties.rowCount
      }
    });
  }
  if (properties.gridProperties.columnCount < columnCount) {
    requests.push({
      appendDimension: {
        sheetId: properties.sheetId,
        dimension: 'COLUMNS',
        length: columnCount - properties.gridProperties.columnCount
      }
    });
  }
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests }
    });
  }
}

/** 指定月の集計済みファネルデータを、同月列へ冪等に保存する。 */
export async function writeFunnelSnapshotToSheet({
  data,
  year,
  month,
  sheets = getSheets(),
  spreadsheetId = FUNNEL_SNAPSHOT_SPREADSHEET_ID
}) {
  const properties = await resolveSheet(sheets, spreadsheetId);
  const sheetName = properties.title;
  const quotedName = quoteSheetName(sheetName);
  const monthLabel = formatSnapshotYearMonth(year, month);
  const snapshotRows = buildFunnelSnapshotRows(data);
  const valueByLabel = new Map(snapshotRows);

  const [headerResponse, itemResponse] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${quotedName}!1:1` }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${quotedName}!A:A` })
  ]);
  const header = (headerResponse.data.values || [[]])[0] || [];
  const existingItems = (itemResponse.data.values || [])
    .slice(1)
    .map(row => String(row[0] || '').trim())
    .filter(Boolean);
  const allItems = [...existingItems];
  for (const [label] of snapshotRows) {
    if (!allItems.includes(label)) allItems.push(label);
  }

  let monthColumnIndex = header.findIndex(value => String(value).trim() === monthLabel);
  if (monthColumnIndex < 1) monthColumnIndex = Math.max(1, header.length);
  const monthColumnLetter = columnIndexToLetter(monthColumnIndex);
  await ensureGridSize(sheets, spreadsheetId, properties, allItems.length + 1, monthColumnIndex + 1);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    resource: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `${quotedName}!A1:A${allItems.length + 1}`,
          values: [['項目'], ...allItems.map(label => [label])]
        },
        {
          range: `${quotedName}!${monthColumnLetter}1:${monthColumnLetter}${allItems.length + 1}`,
          values: [[monthLabel], ...allItems.map(label => [valueOrBlank(valueByLabel.get(label))])]
        }
      ]
    }
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: properties.sheetId,
              gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 }
            },
            fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'
          }
        },
        {
          repeatCell: {
            range: {
              sheetId: properties.sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: monthColumnIndex + 1
            },
            cell: {
              userEnteredFormat: {
                backgroundColorStyle: { rgbColor: { red: 0.9, green: 0.9, blue: 0.9 } },
                textFormat: { bold: true }
              }
            },
            fields: 'userEnteredFormat(backgroundColorStyle,textFormat)'
          }
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId: properties.sheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: 1
            },
            properties: { pixelSize: 360 },
            fields: 'pixelSize'
          }
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId: properties.sheetId,
              dimension: 'COLUMNS',
              startIndex: monthColumnIndex,
              endIndex: monthColumnIndex + 1
            },
            properties: { pixelSize: 110 },
            fields: 'pixelSize'
          }
        }
      ]
    }
  });

  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheetName,
    range: `${monthColumnLetter}1:${monthColumnLetter}${allItems.length + 1}`,
    monthLabel,
    itemCount: allItems.length
  };
}

/** DB・アンケート・Discordの画面用集計を取得してスプレッドシートへ保存する。 */
export async function exportFunnelSnapshotForMonth(year, month, options = {}) {
  const { data, warnings } = await fetchFunnelDataForMonth(year, month);
  const result = await writeFunnelSnapshotToSheet({
    data,
    year,
    month,
    ...options
  });
  return { ...result, warnings };
}
