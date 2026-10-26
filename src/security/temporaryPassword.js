import { randomBytes } from 'node:crypto';

export function generateTemporaryPassword() {
  return randomBytes(24).toString('base64url');
}
