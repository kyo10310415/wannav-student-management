import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLegacyBroadcastRecipients } from '../src/utils/broadcastRecovery.js';

const targets = count => Array.from({ length: count }, (_, index) => ({
  student_id: String(index + 1).padStart(3, '0'),
  name: `Student ${index + 1}`
}));

test('legacy recovery excludes sent recipients and retries failed and pending recipients', () => {
  const result = classifyLegacyBroadcastRecipients(
    targets(6),
    [
      { student_id: '001', was_sent: true, was_failed: false },
      { student_id: '002', was_sent: false, was_failed: true },
      { student_id: '003', was_sent: true, was_failed: false },
      { student_id: '004', was_sent: true, was_failed: false }
    ],
    { status: 'interrupted', sent: 3, failed: 1 }
  );

  assert.deepEqual(result.map(row => row.status), [
    'sent', 'failed', 'sent', 'sent', 'unknown', 'pending'
  ]);
});

test('legacy recovery protects missing logs inside the processed prefix', () => {
  const result = classifyLegacyBroadcastRecipients(
    targets(6),
    [
      { student_id: '001', was_sent: true, was_failed: false },
      { student_id: '003', was_sent: true, was_failed: false },
      { student_id: '004', was_sent: true, was_failed: false }
    ],
    { status: 'interrupted', sent: 2, failed: 0 }
  );

  assert.deepEqual(result.map(row => row.status), [
    'sent', 'unknown', 'sent', 'sent', 'unknown', 'pending'
  ]);
});

test('logs written after the last progress checkpoint are still treated as sent', () => {
  const students = targets(200);
  const logs = students.slice(0, 186).map(student => ({
    student_id: student.student_id,
    was_sent: true,
    was_failed: false
  }));
  const result = classifyLegacyBroadcastRecipients(
    students,
    logs,
    { status: 'interrupted', sent: 170, failed: 10 }
  );

  assert.equal(result.filter(row => row.status === 'sent').length, 186);
  assert.equal(result[186].status, 'unknown');
  assert.equal(result[187].status, 'pending');
});

test('non-interrupted legacy jobs do not invent an uncertain delivery', () => {
  const result = classifyLegacyBroadcastRecipients(
    targets(3),
    [{ student_id: '001', was_sent: true, was_failed: false }],
    { status: 'failed', sent: 1, failed: 0 }
  );

  assert.deepEqual(result.map(row => row.status), ['sent', 'pending', 'pending']);
});
