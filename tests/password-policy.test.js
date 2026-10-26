import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateNewPassword } from '../src/security/passwordPolicy.js';
import { generateTemporaryPassword } from '../src/security/temporaryPassword.js';

const cases = [
  ['a'.repeat(14), '新しいパスワードは15文字以上にしてください'], ['a'.repeat(15), null],
  ['a'.repeat(72), null], ['a'.repeat(73), '新しいパスワードはUTF-8で72バイト以内にしてください'],
  ['日'.repeat(24), null], ['日'.repeat(25), '新しいパスワードはUTF-8で72バイト以内にしてください'],
  ['😀'.repeat(14), '新しいパスワードは15文字以上にしてください'], ['😀'.repeat(15), null],
  ['😀'.repeat(18), null], ['😀'.repeat(19), '新しいパスワードはUTF-8で72バイト以内にしてください'],
  ['e\u0301'.repeat(7), '新しいパスワードは15文字以上にしてください'], ['e\u0301'.repeat(8), null],
  [' '.repeat(15), null], [' ' + 'a'.repeat(13) + ' ', null]
];

test('new passwords count Unicode code points and reject bcrypt UTF-8 truncation at exact boundaries', () => {
  for (const [password, expected] of cases) assert.equal(validateNewPassword(password), expected);
});

test('non-string input is rejected without implicit conversion or password normalization', () => {
  for (const value of [undefined, null, 123456789012345, false, [], {}, { toString: () => { throw new Error('Unexpected conversion'); } }]) {
    assert.equal(validateNewPassword(value), '新しいパスワードは文字列で入力してください');
  }
  const password = ' ' + 'a'.repeat(13) + ' ';
  assert.equal(validateNewPassword(password), null);
  assert.equal(validateNewPassword(password.trim()), '新しいパスワードは15文字以上にしてください');
});

test('generated temporary passwords satisfy the policy without changing their issuance behavior', () => {
  for (let i = 0; i < 16; i++) assert.equal(validateNewPassword(generateTemporaryPassword()), null);
});

async function changeForm(newPassword, confirmPassword = newPassword) {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const fn = source.match(/async function handleChangePassword\(e, isFirstTime\) \{[\s\S]*?\r?\n\}/)?.[0];
  assert.ok(fn);
  const calls = [], errors = [], alerts = [];
  const errorDiv = { textContent: '', classList: { remove: value => errors.push(value) } };
  const elements = { 'current-password': { value: 'synthetic-existing-password' }, 'new-password': { value: newPassword },
    'confirm-password': { value: confirmPassword }, 'change-password-error': errorDiv };
  const context = { document: { getElementById: id => elements[id] }, TextEncoder, API_BASE: '', sessionToken: 'synthetic-session',
    axios: { post: async (...args) => { calls.push(args); return { data: { success: true } }; } },
    alert: value => alerts.push(value), currentUser: { mustChangePassword: true }, renderHeader: () => {}, loadInitialData: async () => {}, renderApp: async () => {} };
  vm.runInNewContext(fn + '\nglobalThis.run = handleChangePassword;', context);
  let prevented = false;
  await context.run({ preventDefault: () => { prevented = true; } }, false);
  assert.equal(prevented, true);
  return { calls, errors, alerts, errorDiv, context };
}

test('change form mirrors Unicode and byte policy before sending a request', async () => {
  for (const [password, expected] of cases) {
    const f = await changeForm(password);
    assert.equal(f.calls.length, expected ? 0 : 1);
    if (expected) assert.equal(f.errorDiv.textContent, expected);
    else {
      assert.equal(f.calls[0][0], '/api/auth/change-password');
      assert.equal(f.calls[0][1].newPassword, password);
      assert.equal(f.calls[0][1].currentPassword, 'synthetic-existing-password');
      assert.equal(f.calls[0][2].headers.Authorization, 'Bearer synthetic-session');
      assert.equal(f.context.currentUser.mustChangePassword, false);
      assert.equal(f.alerts[0], 'パスワードを変更しました');
    }
  }
});

test('confirmation mismatch remains first and never submits', async () => {
  const f = await changeForm('a'.repeat(15), 'different');
  assert.equal(f.calls.length, 0); assert.equal(f.errorDiv.textContent, 'パスワードが一致しません');
});

test('change screen explains the new limits and applies minimum length to both new fields', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const fn = source.match(/function showChangePasswordPage\(isFirstTime = false\) \{[\s\S]*?\r?\n\}/)?.[0];
  assert.ok(fn); const app = { innerHTML: '' }; let event;
  const context = { document: { getElementById: id => id === 'app' ? app : { addEventListener: (...args) => { event = args; } } }, handleChangePassword: () => {} };
  vm.runInNewContext(fn + '\nshowChangePasswordPage(true);', context);
  assert.equal((app.innerHTML.match(/minlength="15"/g) || []).length, 2);
  assert.equal(app.innerHTML.includes('UTF-8で72バイト以内'), true);
  assert.equal(app.innerHTML.includes('4文字以上'), false);
  assert.equal(event[0], 'submit');
});
