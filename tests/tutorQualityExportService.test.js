import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TUTOR_QUALITY_EXPORT_HEADERS,
  buildTutorQualityExportRows,
  buildTutorQualitySnapshot
} from '../src/services/tutorQualityExportService.js';

const tutors = [
  {
    employee_id: 'T-001',
    tutor_name: '山田Tutor',
    notion_name: '山田',
    name: 'Yamada',
    email: 'yamada@example.com'
  },
  {
    employee_id: 'T-002',
    tutor_name: '佐藤Tutor',
    notion_name: '佐藤'
  }
];

test('builds weighted overall and per-tutor quality summaries', () => {
  const snapshot = buildTutorQualitySnapshot(tutors, [
    {
      tutor_employee_id: 'T-001',
      quality_evaluation: {
        version: 2,
        opening_anxiety_check: { status: 'met' },
        specific_praise: { status: 'met' }
      }
    },
    {
      tutor_employee_id: null,
      tutor_name: '山田',
      quality_evaluation: {
        version: 2,
        opening_anxiety_check: { status: 'not_met' },
        specific_praise: { status: 'met' }
      }
    },
    {
      tutor_employee_id: 'T-002',
      quality_evaluation: {
        version: 2,
        opening_anxiety_check: { status: 'met' },
        specific_praise: { status: 'not_met' }
      }
    },
    {
      tutor_employee_id: null,
      tutor_name: '紐付かないTutor',
      quality_evaluation: {
        version: 2,
        opening_anxiety_check: { status: 'met' }
      }
    }
  ]);

  assert.equal(snapshot.overall.totalMinutes, 3);
  assert.equal(snapshot.unassignedMinutes, 1);
  assert.equal(snapshot.tutors[0].totalMinutes, 2);
  assert.equal(snapshot.tutors[1].totalMinutes, 1);

  const overallOpening = snapshot.overall.metrics.find(
    metric => metric.key === 'opening_anxiety_check'
  );
  assert.ok(Math.abs(overallOpening.rate - (200 / 3)) < 1e-10);
});

test('creates an overall row and one row per tutor for the selected month', () => {
  const snapshot = buildTutorQualitySnapshot(tutors, []);
  const rows = buildTutorQualityExportRows(
    snapshot,
    2026,
    9,
    new Date('2026-09-11T03:04:05Z')
  );

  assert.equal(TUTOR_QUALITY_EXPORT_HEADERS.length, 16);
  assert.equal(rows.length, 3);
  assert.equal(rows[0][0], '2026/9');
  assert.equal(rows[0][1], '2026/09/11 12:04:05');
  assert.equal(rows[0][2], '全体平均');
  assert.equal(rows[1][2], 'Tutor平均');
  assert.equal(rows[1][3], 'T-001');
  assert.equal(rows[1][4], '山田Tutor');
  assert.equal(rows[0].length, TUTOR_QUALITY_EXPORT_HEADERS.length);
});
