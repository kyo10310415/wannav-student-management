import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { uploadRequestBodyLimit } from './uploadBodyLimit.js';

// Reports contain short text fields, not files. Bound bytes before crew ownership JSON parsing.
export const LESSON_REPORT_REQUEST_MAX_BYTES = 256 * 1024;
const limitLessonReportBody = uploadRequestBodyLimit(LESSON_REPORT_REQUEST_MAX_BYTES, {
  tooLargeError: 'Lesson report request too large',
  invalidError: 'Invalid lesson report request'
});

const roles = new Set(['admin', 'leader', 'crew']);
const leaders = new Set(['admin', 'leader']);
const under = (path, prefix) => path === prefix || path.startsWith(prefix + '/');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

const internalRoutes = [
  ['GET', /^\/api\/(students|tutors)\/sync$/],
  ['POST', /^\/api\/helper-requests\/check-expired$/],
  ['GET', /^\/api\/survey\/stats-all$/],
  ['POST', /^\/api\/(roulette\/generate|survey\/responses)$/],
  ['GET', /^\/api\/tutors\/monthly-stats\/\d{4}\/\d{1,2}$/],
  ['GET', /^\/api\/tutors\/satisfaction\/all$/],
  ['GET', /^\/api\/schedules\/absence-stats$/]
];
const integrationRoutes = [
  ['GET', /^\/api\/external\/lesson-start-dates$/],
  ['GET', /^\/api\/(students|tutors)\/sync$/],
  ['POST', /^\/api\/survey\/responses$/],
  ['GET', /^\/api\/vq-diagnosis\/status$/]
];
const matches = (entries, method, path) => entries.some(([m, pattern]) => m === method && pattern.test(path));

export function installApiAccess(app, { db, integrationKey = () => process.env.GAS_SYNC_API_KEY } = {}) {
  if (typeof db !== 'function') throw new Error('Session lookup is required');
  const internalKey = randomBytes(32).toString('hex');
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    let path;
    try { path = decodeURIComponent(c.req.path).replace(/\/+$/, ''); }
    catch { return c.json({ success: false, error: '不正なパスです' }, 400); }
    const method = c.req.method;
    if (method === 'POST' && path === '/api/auth/login') return next();

    // These handlers already enforce their own dedicated machine credentials.
    if (under(path, '/api/gas-broadcast') || (method === 'GET' && path === '/api/email-reminders/batch')) return next();

    // Public student links are opaque, expiring capabilities checked again by the route.
    if (['GET', 'HEAD'].includes(method) && /^\/api\/roulette\/verify\/[a-f0-9]{64}$/.test(path)) return next();
    if (method === 'POST' && path === '/api/roulette/spin') {
      let body;
      try { body = await c.req.json(); }
      catch { return c.json({ success: false, error: 'JSON入力が不正です' }, 400); }
      if (!/^[a-f0-9]{64}$/.test(body?.token || '')) return c.json({ success: false, error: 'Invalid token' }, 400);
      return next();
    }

    if (c.req.header('X-Internal-Request')) {
      if (!equal(c.req.header('X-Internal-Request'), internalKey) || !matches(internalRoutes, method, path)) {
        return c.json({ success: false, error: '内部処理の認証に失敗しました' }, 403);
      }
      c.set('internalRequest', true);
      return next();
    }
    const suppliedIntegrationKey = c.req.header('X-Sync-API-Key');
    if (suppliedIntegrationKey) {
      const key = integrationKey();
      if (typeof key !== 'string' || key.length < 32 || !equal(suppliedIntegrationKey, key)) {
        return c.json({ success: false, error: '連携認証に失敗しました' }, 401);
      }
      if (!matches(integrationRoutes, method, path)) return c.json({ success: false, error: '許可されていない連携操作です' }, 403);
      return next();
    }

    const token = c.req.header('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) return c.json({ success: false, error: '認証が必要です' }, 401);
    let user;
    try {
      user = (await db(`SELECT u.id, u.email, u.role, u.must_change_password,
        t.id AS tutor_id, t.tutor_name, t.notion_name, t.employee_id
        FROM sessions s JOIN users u ON s.user_id = u.id
        LEFT JOIN tutors t ON LOWER(t.email) = LOWER(u.email)
        WHERE s.session_token = $1 AND s.expires_at > NOW()`, [token])).rows[0];
    } catch {
      return c.json({ success: false, error: '認証サービスを利用できません' }, 503);
    }
    if (!user) return c.json({ success: false, error: 'セッションが無効または期限切れです' }, 401);
    if (!roles.has(user.role)) return c.json({ success: false, error: '権限がありません' }, 403);
    c.set('authenticatedUser', user);
    if (user.must_change_password && !['/api/auth/verify', '/api/auth/logout', '/api/auth/change-password'].includes(path)) {
      return c.json({ success: false, error: '先にパスワードを変更してください', code: 'PASSWORD_CHANGE_REQUIRED' }, 403);
    }
    const adminOnly = ['/api/database', '/api/tutor-red-list', '/api/extension-review', '/api/survey/debug', '/api/lesson-report-reminder/check-mapping'];
    if ((adminOnly.some(prefix => under(path, prefix)) ||
      (under(path, '/api/users') && !(method === 'GET' && path === '/api/users/consultation-staff')) ||
      path === '/api/auth/reset-password') && user.role !== 'admin') {
      return c.json({ success: false, error: '管理者権限が必要です' }, 403);
    }
    const leaderOnly = ['/api/handover', '/api/funnel', '/api/vq-diagnosis', '/api/minutes', '/api/lesson-contents'];
    const managerOperation = leaderOnly.some(prefix => under(path, prefix)) ||
      under(path, '/api/lessons/sync') || path === '/api/lessons/sync-from-sheet' ||
      (under(path, '/api/lesson-reports') && method === 'DELETE') ||
      (path === '/api/lesson-reports' && ['GET', 'HEAD'].includes(method)) ||
      (under(path, '/api/tutors') && !['GET', 'HEAD'].includes(method)) ||
      /^\/api\/schedules\/absence(?:-stats|-requests\/pending|\/[^/]+\/approve)$/.test(path) ||
      /^\/api\/roulette\/(winners|losers|unopened)(\/|$)/.test(path) ||
      (under(path, '/api/reminders')) ||
      (under(path, '/api/settings') && !['GET', 'HEAD'].includes(method)) ||
      (path === '/api/daily-reports/reminder-setting' && method === 'PUT') ||
      (under(path, '/api/daily-reports') && method === 'DELETE');
    if (managerOperation && !leaders.has(user.role)) return c.json({ success: false, error: 'リーダー以上の権限が必要です' }, 403);
    if (method === 'POST' && path === '/api/lesson-reports') {
      const rejected = await limitLessonReportBody(c, async () => {});
      if (rejected) return rejected;
    }
    if (user.role === 'crew') {
      const crewWrites = [
        ['POST', /^\/api\/auth\/(logout|change-password)$/],
        ['PATCH', /^\/api\/students\/[^/]+\/pro-plan$/],
        ['POST', /^\/api\/lesson-reports$/],
        ['POST', /^\/api\/daily-reports(?:\/\d+\/comments)?$/],
        ['POST', /^\/api\/schedules\/absence$/],
        ['DELETE', /^\/api\/schedules\/absence\/[^/]+\/[^/]+$/],
        ['POST', /^\/api\/helper-requests(?:\/\d+\/accept)?$/],
        ['DELETE', /^\/api\/helper-requests\/\d+$/],
        ['POST', /^\/api\/lesson-completion\/batch$/]
      ];
      // Broadcast has its own session-backed recipient/owner authorization.
      if (!['GET', 'HEAD'].includes(method) && !under(path, '/api/broadcast') && !matches(crewWrites, method, path)) {
        return c.json({ success: false, error: 'この操作にはリーダー以上の権限が必要です' }, 403);
      }
      if (method === 'POST' && path === '/api/helper-requests') {
        let body;
        try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'JSON入力が不正です' }, 400); }
        if (!user.employee_id || String(body?.requesting_tutor_id) !== String(user.employee_id) || !user.notion_name || !body?.student_id) {
          return c.json({ success: false, error: '自分の担当生徒の依頼のみ作成できます' }, 403);
        }
        let owned;
        try { owned = (await db('SELECT student_id FROM students WHERE student_id = $1 AND homeroom_tutor = $2', [body.student_id, user.notion_name])).rows[0]; }
        catch { return c.json({ success: false, error: '担当確認を利用できません' }, 503); }
        if (!owned) return c.json({ success: false, error: '他のTutorの担当生徒は指定できません' }, 403);
      }
      if (method === 'POST' && /^\/api\/helper-requests\/\d+\/accept$/.test(path)) {
        let body;
        try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'JSON入力が不正です' }, 400); }
        if (!user.employee_id || String(body?.tutor_id) !== String(user.employee_id)) return c.json({ success: false, error: '他のTutorとして受諾できません' }, 403);
      }
      const helperDelete = method === 'DELETE' && path.match(/^\/api\/helper-requests\/(\d+)$/);
      if (helperDelete) {
        let owned;
        try { owned = (await db('SELECT id FROM helper_requests WHERE id = $1 AND requesting_tutor_id = $2', [helperDelete[1], user.employee_id])).rows[0]; }
        catch { return c.json({ success: false, error: '依頼確認を利用できません' }, 503); }
        if (!user.employee_id || !owned) return c.json({ success: false, error: '他のTutorの依頼は削除できません' }, 403);
      }
      const ownReport = path.match(/^\/api\/daily-reports\/(?:tutor|check)\/([^/]+)(?:\/|$)/);
      if (ownReport && (!user.tutor_id || String(user.tutor_id) !== ownReport[1])) {
        return c.json({ success: false, error: '自分の日報のみ参照できます' }, 403);
      }
      if (method === 'POST' && path === '/api/daily-reports') {
        let body;
        try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'JSON入力が不正です' }, 400); }
        if (!user.tutor_id || String(user.tutor_id) !== String(body?.tutor_id)) return c.json({ success: false, error: '他のTutorの日報は変更できません' }, 403);
      }
      if (method === 'POST' && path === '/api/schedules/absence') {
        let body;
        try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'JSON入力が不正です' }, 400); }
        if (typeof body?.tutor_email !== 'string' || body.tutor_email.toLowerCase() !== user.email.toLowerCase()) {
          return c.json({ success: false, error: '他のTutorの申請はできません' }, 403);
        }
      }
      const absence = path.match(/^\/api\/schedules\/absence\/[^/]+\/([^/]+)$/);
      if (method === 'DELETE' && absence && absence[1].toLowerCase() !== user.email.toLowerCase()) {
        return c.json({ success: false, error: '他のTutorの申請は変更できません' }, 403);
      }
      const studentEdit = method === 'PATCH' && path.match(/^\/api\/students\/([^/]+)\/pro-plan$/);
      const lessonReport = method === 'POST' && path === '/api/lesson-reports';
      if (studentEdit || lessonReport) {
        let id = studentEdit && studentEdit[1];
        if (lessonReport) {
          try { id = (await c.req.json())?.student_id; } catch { return c.json({ success: false, error: 'JSON入力が不正です' }, 400); }
        }
        if (!id || !user.notion_name) return c.json({ success: false, error: '担当生徒を確認できません' }, 403);
        let owned;
        try { owned = (await db('SELECT student_id FROM students WHERE student_id = $1 AND homeroom_tutor = $2', [id, user.notion_name])).rows[0]; }
        catch { return c.json({ success: false, error: '担当確認を利用できません' }, 503); }
        if (!owned) return c.json({ success: false, error: '他のTutorの担当生徒は変更できません' }, 403);
      }
    }
    return next();
  });
  return async (path, options = {}) => {
    const url = new URL(path, 'http://internal.invalid');
    if (!path.startsWith('/api/') || url.origin !== 'http://internal.invalid' ||
      !matches(internalRoutes, options.method || 'GET', url.pathname)) throw new Error('Internal route is not allowed');
    const headers = new Headers(options.headers);
    headers.set('X-Internal-Request', internalKey);
    return app.request(url.href, { ...options, headers });
  };
}
