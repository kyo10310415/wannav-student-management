import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getNewAssignmentMonthWindow,
  isValidNewAssignmentMonth
} from '../src/services/handoverMonthService.js';

test('resolves current and next month using the JST calendar', () => {
  // 2026-08-31 15:30 UTC is already 2026-09-01 in Japan.
  const now = new Date('2026-08-31T15:30:00.000Z');

  assert.deepEqual(getNewAssignmentMonthWindow('current', now), {
    selection: 'current',
    startDate: '2026-09-01',
    endDate: '2026-10-01',
    label: '2026/09'
  });
  assert.deepEqual(getNewAssignmentMonthWindow('next', now), {
    selection: 'next',
    startDate: '2026-10-01',
    endDate: '2026-11-01',
    label: '2026/10'
  });
});

test('moves the next-month window across a year boundary', () => {
  const now = new Date('2026-12-15T03:00:00.000Z');

  assert.deepEqual(getNewAssignmentMonthWindow('next', now), {
    selection: 'next',
    startDate: '2027-01-01',
    endDate: '2027-02-01',
    label: '2027/01'
  });
});

test('rejects unsupported month selections', () => {
  assert.equal(isValidNewAssignmentMonth('current'), true);
  assert.equal(isValidNewAssignmentMonth('next'), true);
  assert.equal(isValidNewAssignmentMonth('previous'), false);
  assert.throws(() => getNewAssignmentMonthWindow('previous'), /Invalid new assignment month/);
});
