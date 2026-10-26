import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateNewPassword } from './src/security/passwordPolicy.js';

/** Create an initial administrator without displaying credentials. */
export async function createAdmin({ env = process.env, query, hash = bcrypt.hash, logger = console } = {}) {
  const email = typeof env.ADMIN_EMAIL === 'string' ? env.ADMIN_EMAIL.trim().toLowerCase() : '';
  const password = env.ADMIN_PASSWORD;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || validateNewPassword(password)) {
    logger.error('ADMIN_EMAIL and a valid ADMIN_PASSWORD are required');
    return 1;
  }

  try {
    const runQuery = query || (await import('./src/db/connection.js')).query;
    const existingUser = await runQuery('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      logger.error('Administrator creation refused: account already exists');
      return 1;
    }

    const passwordHash = await hash(password, 10);
    await runQuery(
      'INSERT INTO users (email, password_hash, role, must_change_password) VALUES ($1, $2, $3, $4) RETURNING id, email, role',
      [email, passwordHash, 'admin', true]
    );
    logger.log('Administrator created; password change is required on first login');
    return 0;
  } catch (error) {
    logger.error('Administrator creation failed');
    return 1;
  }
}

export function isDirectInvocation(moduleUrl, entryPath = process.argv[1]) {
  return Boolean(entryPath) && moduleUrl === pathToFileURL(resolve(entryPath)).href;
}

if (isDirectInvocation(import.meta.url)) {
  process.exit(await createAdmin());
}
