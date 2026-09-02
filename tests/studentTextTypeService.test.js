import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStudentTextTypeMap,
  normalizeStudentTextTypeStudentId,
  resolveStudentTextType
} from '../src/services/studentTextTypeService.js';

test('maps the character selection marker to the new text type', () => {
  assert.equal(resolveStudentTextType('キャラ選択'), '新');
  assert.equal(resolveStudentTextType('  キャラ選択  '), '新');
});

test('maps blank or unrecognized legacy values to the old text type', () => {
  assert.equal(resolveStudentTextType(''), '旧');
  assert.equal(resolveStudentTextType(null), '旧');
  assert.equal(resolveStudentTextType('その他'), '旧');
});

test('normalizes student IDs before matching sources', () => {
  assert.equal(normalizeStudentTextTypeStudentId(' ab　－ 123 '), 'AB-123');
});

test('aligns B and AP rows and handles omitted blank AP cells', () => {
  const result = buildStudentTextTypeMap(
    [[' ab-1 '], ['CD-2'], ['']],
    [['キャラ選択']]
  );

  assert.deepEqual([...result.entries()], [
    ['AB-1', '新'],
    ['CD-2', '旧']
  ]);
});
