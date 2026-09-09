import { query } from '../db/connection.js';

/** Session authentication only; role authorization belongs to each consumer. */
export function createRequireAuth({ query: querySession = query } = {}) {
  return async function requireAuth(c, next) {
    const authorization = c.req.header('Authorization') || '';
    const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization);
    if (!match || match[1].length > 255) {
      return c.json({ success: false, error: '認証が必要です' }, 401);
    }

    let session;
    try {
      const result = await querySession(
        `SELECT s.user_id, u.email, u.role
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.session_token = $1
            AND s.expires_at > NOW()`,
        [match[1]]
      );
      session = result.rows[0];
    } catch {
      // Never expose DB errors or tokens. Do not catch downstream handler errors.
      return c.json({ success: false, error: '認証情報を確認できませんでした' }, 500);
    }

    if (!session) {
      return c.json({ success: false, error: 'セッションが無効または期限切れです' }, 401);
    }
    c.set('user', { id: session.user_id, email: session.email, role: session.role });
    await next();
  };
}

export const requireAuth = createRequireAuth();
