export function validateNewPassword(password) {
  if (typeof password !== 'string') {
    return '新しいパスワードは文字列で入力してください';
  }
  if (Array.from(password).length < 15) {
    return '新しいパスワードは15文字以上にしてください';
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return '新しいパスワードはUTF-8で72バイト以内にしてください';
  }
  return null;
}
