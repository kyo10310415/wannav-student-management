import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { query } from '../db/connection.js';
import { extensionReviewService } from '../services/extensionReviewService.js';
import { extensionReviewClient } from '../services/extensionReviewAI.js';
import { fetchReviewNotion } from '../services/extensionReviewSources.js';
import { fetchReviewTranscript } from '../services/driveService.js';
import { parseReviewUrl, reviewError, transcriptSpeakerLabels } from '../services/extensionReviewRules.js';

export function createExtensionReviewRoutes({ db = query, service = extensionReviewService,
  enabled = () => process.env.EXTENSION_REVIEW_AI_ENABLED === 'true',
  notion = fetchReviewNotion, docs = fetchReviewTranscript, ai = extensionReviewClient } = {}) {
  const app = new Hono();
  app.onError((error, c) => c.json({ success: false,
    error: error.safe ? error.message : '延長審査AI採点の処理に失敗しました' }, error.safe ? error.status : 500));
  const rateWindows = new Map();
  app.use('*', async (c, next) => {
    try {
      const token = c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!token) return c.json({ success: false, error: '認証が必要です' }, 401);
      const user = (await db(`SELECT u.id, u.role FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.session_token = $1 AND s.expires_at > NOW()`, [token])).rows[0];
      if (!user) return c.json({ success: false, error: 'セッションが無効です' }, 401);
      if (!['admin','leader'].includes(user.role)) return c.json({ success: false, error: 'リーダー以上のみ利用できます' }, 403);
      c.set('reviewUser', user);
      if (c.req.path.endsWith('/capabilities')) {
        return c.json({ success: true, data: { enabled: enabled(), canAdmin: user.role === 'admin' } });
      }
      if (!enabled()) return c.json({ success: false, error: '延長審査AI採点は無効です' }, 403);
      if (c.req.header('Content-Length') && Number(c.req.header('Content-Length')) > 1000000) return c.json({ success: false, error: '入力が大きすぎます' }, 413);
      const key = user.id, now = Date.now();
      const recent = (rateWindows.get(key) || []).filter(time => now - time < 60000);
      if (recent.length >= 30) return c.json({ success: false, error: 'アクセス上限です。1分後にお試しください' }, 429);
      recent.push(now); rateWindows.set(key, recent);
      for (const [id, times] of rateWindows) if (now - times.at(-1) >= 60000) rateWindows.delete(id);
      await next();
    } catch (error) {
      // Never log SDK errors, request URLs/bodies, transcript, profile, or credentials.
      return c.json({ success: false, error: error.safe ? error.message : '延長審査AI採点の処理に失敗しました' }, error.safe ? error.status : 500);
    }
  });
  app.use('*', bodyLimit({ maxSize: 1000000, onError: c => c.json({ success: false, error: '入力が大きすぎます' }, 413) }));
  async function admin(c, next) {
    if (c.get('reviewUser').role !== 'admin') return c.json({ success: false, error: '管理者のみ利用できます' }, 403);
    await next();
  }
  async function body(c) {
    const text = await c.req.text();
    if (text.length > 300000) throw reviewError('入力が大きすぎます', 413);
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch { throw reviewError('JSON入力が不正です'); }
  }
  app.get('/tutors', async c => c.json({ success: true, data: await service.tutors() }));
  app.get('/settings', admin, async c => c.json({ success: true, data: await service.settings(c.req.query('id')) }));
  app.get('/settings/versions', admin, async c => c.json({ success: true, data: (await db('SELECT id, created_at, created_by FROM extension_review_settings ORDER BY id DESC LIMIT 100')).rows }));
  app.post('/settings', admin, async c => c.json({ success: true, data: await service.saveSettings(await body(c), c.get('reviewUser')) }));
  app.post('/generate', async c => c.json({ success: true, data: await service.generate(await body(c), c.get('reviewUser')) }));
  app.get('/history', async c => c.json({ success: true, data: await service.history(c.req.query()) }));
  app.get('/analysis', async c => c.json({ success: true, data: await service.analysis() }));
  app.get('/results/:id', async c => c.json({ success: true, data: await service.get(c.req.param('id')) }));
  app.put('/results/:id', admin, async c => c.json({ success: true, data: await service.edit(c.req.param('id'), await body(c), c.get('reviewUser')) }));
  app.post('/results/:id/review', async c => c.json({ success: true, data: await service.review(c.req.param('id'), c.get('reviewUser')) }));
  app.post('/results/:id/confirm', admin, async c => c.json({ success: true, data: await service.review(c.req.param('id'), c.get('reviewUser'), true) }));
  app.get('/results/:id/edits', admin, async c => c.json({ success: true, data: (await db('SELECT id, result, edited_by, created_at FROM extension_review_edits WHERE review_id = $1 ORDER BY id DESC', [c.req.param('id')])).rows }));
  app.post('/diagnostics', admin, async c => {
    const input = await body(c);
    const checks = {};
    async function check(name, work) {
      try { checks[name] = { ok: true, data: await work() }; }
      catch (error) { checks[name] = { ok: false, error: error.safe ? error.message : '接続または権限を確認してください' }; }
    }
    await check('database', async () => { await db('SELECT 1'); return '接続成功'; });
    await check('model', async () => {
      const model = process.env.OPENAI_EXTENSION_REVIEW_MODEL || 'gpt-6-sol';
      await ai().models.retrieve(model); return model;
    });
    const settings = await service.settings();
    checks.criteria = { ok: Boolean(settings.id && settings.config.criteria.trim()), data: { version: settings.id, registeredRounds: settings.config.scripts.map(s => Boolean(s.trim())) } };
    if (input.notionUrl) await check('notion', async () => {
      const source = await notion(parseReviewUrl(input.notionUrl,'notion'), settings.config.mapping, undefined, { inspectBlocks: true });
      return { properties: source.propertySchema, blockHeadings: source.blockHeadings, availableFields: Object.fromEntries(Object.entries(source.profile).map(([key,value]) => [key,value !== null])) };
    });
    if (input.documentUrl) await check('docs', async () => {
      const document = await docs(parseReviewUrl(input.documentUrl,'docs'));
      return { characters: document.text.length, tabs: document.tabs, speakers: transcriptSpeakerLabels(document.text) };
    });
    return c.json({ success: true, data: checks });
  });
  return app;
}

export default createExtensionReviewRoutes();
