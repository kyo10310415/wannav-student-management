import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFunnelSnapshotRows,
  columnIndexToLetter,
  formatSnapshotYearMonth,
  writeFunnelSnapshotToSheet
} from '../src/services/funnelSheetExportService.js';
import { isLastDayOfMonth } from '../src/jobs/funnelMonthlySnapshot.js';

test('formats monthly snapshot headers as yyyy/mm', () => {
  assert.equal(formatSnapshotYearMonth(2026, 9), '2026/09');
  assert.equal(formatSnapshotYearMonth(2026, 12), '2026/12');
});

test('converts zero-based spreadsheet column indexes to A1 letters', () => {
  assert.equal(columnIndexToLetter(0), 'A');
  assert.equal(columnIndexToLetter(1), 'B');
  assert.equal(columnIndexToLetter(25), 'Z');
  assert.equal(columnIndexToLetter(26), 'AA');
});

test('detects month end including leap years', () => {
  assert.equal(isLastDayOfMonth(2026, 9, 30), true);
  assert.equal(isLastDayOfMonth(2026, 9, 29), false);
  assert.equal(isLastDayOfMonth(2028, 2, 29), true);
  assert.equal(isLastDayOfMonth(2027, 2, 28), true);
});

test('flattens overall, attrition, cancellation and tutor funnel data', () => {
  const metric = (numerator, denominator, rate) => ({ numerator, denominator, rate });
  const rows = buildFunnelSnapshotRows({
    overall: {
      denominator: 10,
      payment: metric(8, 10, 80),
      reservation: metric(15, 16, 93.8),
      completion: metric(12, 15, 80),
      survey: metric(7, 10, 70),
      surveyAmongCompleted: metric(6, 8, 75)
    },
    attrition: {
      cohortCount: 5,
      cumulativeFiveMonth: metric(2, 5, 40),
      statusAttritionCount: null,
      months: [{ month: 1, ...metric(1, 5, 20) }]
    },
    cancellationBreakdown: {
      lessonNotAttendedTotal: 8,
      completed: 12,
      bookedNotAttended: 3,
      studentReschedule: 1,
      noShow: 1,
      tutorReschedule: 1,
      other: 0,
      unreservedCount: 2,
      unavailable: { bookingLinkSent: null }
    },
    tutors: [{
      employeeId: 'T001',
      name: 'Tutor A',
      metrics: {
        denominator: 4,
        payment: metric(4, 4, 100),
        reservation: metric(8, 8, 100),
        completion: metric(7, 8, 87.5),
        survey: metric(3, 4, 75),
        surveyAmongCompleted: metric(3, 4, 75)
      }
    }]
  });
  const values = new Map(rows);

  assert.equal(values.get('生徒様全体｜レッスン予約｜分母'), 16);
  assert.equal(values.get('離脱分析｜1カ月目離脱｜率（%）'), 20);
  assert.equal(values.get('離脱分析｜状態的離脱数'), '');
  assert.equal(values.get('レッスン未受講の内訳｜予約リンク送付'), '');
  assert.equal(values.get('担当Tutor別｜Tutor A｜レッスン実施｜率（%）'), 87.5);
});

test('writes the same month to the same sheet column', async () => {
  const state = { header: [], items: [], valueBatches: [] };
  const sheets = {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: [{
            properties: {
              sheetId: 0,
              title: 'シート1',
              gridProperties: { rowCount: 1000, columnCount: 26 }
            }
          }]
        }
      }),
      values: {
        get: async ({ range }) => {
          if (range.endsWith('!1:1')) return { data: { values: state.header.length ? [state.header] : [] } };
          return { data: { values: state.items.length ? [['項目'], ...state.items.map(item => [item])] : [] } };
        },
        batchUpdate: async ({ resource }) => {
          state.valueBatches.push(resource.data);
          const itemWrite = resource.data[0].values;
          const monthWrite = resource.data[1];
          state.items = itemWrite.slice(1).map(row => row[0]);
          const monthColumn = monthWrite.range.match(/!([A-Z]+)1:/)[1];
          const columnIndex = monthColumn === 'B' ? 1 : 2;
          state.header[0] = '項目';
          state.header[columnIndex] = monthWrite.values[0][0];
        }
      },
      batchUpdate: async () => ({ data: {} })
    }
  };
  const data = {
    overall: {},
    attrition: { months: [] },
    cancellationBreakdown: { unavailable: {} },
    tutors: []
  };

  const first = await writeFunnelSnapshotToSheet({
    data, year: 2026, month: 9, sheets, spreadsheetId: 'test-sheet'
  });
  const second = await writeFunnelSnapshotToSheet({
    data, year: 2026, month: 9, sheets, spreadsheetId: 'test-sheet'
  });

  assert.equal(first.range.startsWith('B1:'), true);
  assert.equal(second.range.startsWith('B1:'), true);
  assert.equal(state.header.filter(value => value === '2026/09').length, 1);
});
