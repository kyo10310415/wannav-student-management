import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchFunnelDataForMonth } from '../services/funnelDataService.js';
import {
  getFunnelDiscordScanJob,
  startFunnelDiscordScan
} from '../services/funnelDiscordService.js';

const app = new Hono();

async function requireLeaderOrAdmin(c, next) {
  const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!sessionToken) {
    return c.json({ success: false, error: '認証が必要です' }, 401);
  }

  const sessionResult = await query(
    `SELECT u.role, u.email
       FROM sessions s
       JOIN users u ON s.user_id = u.id
      WHERE s.session_token = $1
        AND s.expires_at > NOW()`,
    [sessionToken]
  );

  if (sessionResult.rows.length === 0) {
    return c.json({ success: false, error: 'セッションが無効です' }, 401);
  }
  if (!['admin', 'leader'].includes(sessionResult.rows[0].role)) {
    return c.json({ success: false, error: 'リーダー以上の権限が必要です' }, 403);
  }

  c.set('currentUser', sessionResult.rows[0]);

  await next();
}

app.post('/discord-scan', requireLeaderOrAdmin, async (c) => {
  try {
    const { year, month } = await c.req.json();
    if (!Number.isInteger(Number(year)) || !Number.isInteger(Number(month)) || Number(month) < 1 || Number(month) > 12) {
      return c.json({ success: false, error: '対象年月が正しくありません' }, 400);
    }
    const job = await startFunnelDiscordScan({
      year: Number(year),
      month: Number(month),
      createdBy: c.get('currentUser')?.email
    });
    return c.json({ success: true, data: job }, 202);
  } catch (error) {
    console.error('[Funnel] Failed to start Discord scan:', error);
    return c.json({ success: false, error: `Discord状況の更新を開始できませんでした: ${error.message}` }, 500);
  }
});

app.get('/discord-scan/:jobId', requireLeaderOrAdmin, async (c) => {
  try {
    const job = await getFunnelDiscordScanJob(c.req.param('jobId'));
    if (!job) return c.json({ success: false, error: '更新ジョブが見つかりません' }, 404);
    return c.json({ success: true, data: job });
  } catch (error) {
    console.error('[Funnel] Failed to get Discord scan status:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/', requireLeaderOrAdmin, async (c) => {
  const year = Number(c.req.query('year'));
  const month = Number(c.req.query('month'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return c.json({ success: false, error: '対象年月が正しくありません' }, 400);
  }

  try {
    const result = await fetchFunnelDataForMonth(year, month);
    return c.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Funnel] Failed to build funnel:', error);
    return c.json({ success: false, error: `ファネルデータの取得に失敗しました: ${error.message}` }, 500);
  }
});

export default app;
