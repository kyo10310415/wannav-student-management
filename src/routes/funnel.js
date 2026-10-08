import { Hono } from 'hono';
import { query } from '../db/connection.js';
import { fetchFunnelDataForMonth } from '../services/funnelDataService.js';
import {
  getFunnelDiscordScanJob,
  fetchChannelMessages,
  startFunnelDiscordScan
} from '../services/funnelDiscordService.js';
import { fetchStudentBroadcastInfo } from '../services/sheetsService.js';
import { normalizeFunnelStudentId } from '../services/funnelService.js';

const app = new Hono();

// 分析用の読み取り専用API。本文を含むため管理者だけに限定する。
app.get('/analysis-export', requireLeaderOrAdmin, async (c) => {
  if (c.get('currentUser')?.role !== 'admin') return c.json({ error: '管理者権限が必要です' }, 403);
  c.header('Cache-Control', 'no-store');
  const year = Number(c.req.query('year'));
  const month = Number(c.req.query('month'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return c.json({ error: '対象年月が正しくありません' }, 400);
  }
  const start = new Date(Date.UTC(year, month - 1, 1, -9));
  const end = new Date(Date.UTC(year, month, 1, -9));
  const followupEnd = new Date(end.getTime() + 7 * 86400000);
  if (followupEnd > new Date()) return c.json({ error: '翌月7日まで確定した月を指定してください' }, 400);
  try {
    const requestedId = normalizeFunnelStudentId(c.req.query('studentId'));
    if (requestedId) {
      const info = (await fetchStudentBroadcastInfo()).find(row => normalizeFunnelStudentId(row.studentId) === requestedId);
      if (!info?.chatUrl || !info?.discordId) return c.json({ error: 'Discord情報が未設定です' }, 404);
      const messages = await fetchChannelMessages(info.chatUrl, start, followupEnd);
      return c.json({ studentId: requestedId, channelUrl: info.chatUrl, messages: messages
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(message => ({ id: message.id, at: message.createdAt, authorId: message.author.id,
          authorName: message.author.username, role: message.author.id === String(info.discordId) ? 'student' : message.author.bot ? 'bot' : 'staff',
          content: message.content, url: message.url })) });
    }
    const [funnel, students, lessons, reports] = await Promise.all([
      fetchFunnelDataForMonth(year, month),
      query('SELECT student_id, name, status, contract_plan, homeroom_tutor, lesson_start_date FROM students'),
      query('SELECT * FROM lessons WHERE lesson_date >= $1 AND lesson_date < $2', [start, end]),
      query('SELECT * FROM lesson_reports WHERE lesson_date >= $1::date AND lesson_date < $2::date',
        [`${year}-${String(month).padStart(2, '0')}-01`, `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`])
    ]);
    return c.json({ exportedAt: new Date(), year, month, cutoff: end, followupEnd,
      historicalStudentStateAvailable: false,
      limitations: ['生徒状態・担当Tutorは取得時点です。月末確定スナップショットとの照合が必要です。'],
      funnel, students: students.rows, lessons: lessons.rows, reports: reports.rows });
  } catch (error) {
    console.error('[Funnel analysis export]', error.message);
    return c.json({ error: error.message }, 500);
  }
});

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
