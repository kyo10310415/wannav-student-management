import { Hono } from 'hono';
import { createRequireAuth } from '../middleware/auth.js';
import { createStudentAiContextService } from '../services/studentAiContextService.js';
import { createStudentAiSelector } from '../services/studentAiSelectionService.js';
import { createStudentAiAnswerService } from '../services/studentAiAnswerService.js';
import { checkAbort, positiveLimit, readStudentAiConfig, createStudentAiClient,
  createStudentAiQuery } from '../services/studentAiRuntime.js';

const defaultQuery = createStudentAiQuery();
const BODY_LIMIT = 32 * 1024;
const messages = {
  400: '質問と比較日付を確認してください。比較する場合はcompareAtにYYYY-MM-DDで比較時点を指定してください。',
  403: 'この機能を利用する権限がありません。',
  404: '生徒が見つかりません。',
  409: '参照記録が更新されました。もう一度実行してください。',
  413: 'リクエストが大きすぎます。',
  422: '資料が処理上限を超えました。質問の対象期間や内容を絞ってください。',
  429: '処理中の質問があります。完了後にもう一度実行してください。',
  500: '回答を処理できませんでした。',
  502: '回答の形式または引用を確認できませんでした。',
  503: 'AIカルテは現在利用できません。',
  504: '処理が時間内に完了しませんでした。もう一度実行してください。'
};
const errorStatus = new Map([
  ...['INVALID_REQUEST', 'INVALID_STUDENT_ID', 'INVALID_QUESTION', 'INVALID_COMPARISON_DATE',
    'COMPARISON_DATE_REQUIRED'].map(code => [code, 400]),
  ['STUDENT_NOT_FOUND', 404], ['SOURCE_CHANGED', 409], ['BODY_TOO_LARGE', 413],
  ...['SOURCE_LIMIT_EXCEEDED', 'SOURCE_TOO_LARGE', 'SELECTION_INPUT_LIMIT', 'SELECTION_CALL_LIMIT',
    'ITEM_TOO_LARGE', 'SELECTION_NOT_REDUCED', 'ANSWER_INPUT_LIMIT'].map(code => [code, 422]),
  ...['INVALID_ANSWER', 'INVALID_SELECTION', 'SELECTION_INCOMPLETE'].map(code => [code, 502]),
  ...['AI_CONFIG', 'AI_UNAVAILABLE', 'SELECTION_UNAVAILABLE'].map(code => [code, 503]),
  ['AI_DEADLINE', 504]
]);
const reject = (c, status) => c.json({ success: false, error: messages[status] }, status);
const invalid = () => { throw new Error('INVALID_REQUEST'); };
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
async function requestBody(c) {
  if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') invalid();
  if (Number(c.req.header('Content-Length')) > BODY_LIMIT) throw new Error('BODY_TOO_LARGE');
  const reader = c.req.raw.body?.getReader();
  if (!reader) invalid();
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > BODY_LIMIT) {
        void reader.cancel().catch(() => {});
        throw new Error('BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { invalid(); }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['question', 'compareAt'].includes(key))) invalid();
  if (typeof body.question !== 'string' || !body.question.trim() || Array.from(body.question).length > 2000) invalid();
  if (Object.hasOwn(body, 'compareAt') && !validDate(body.compareAt)) invalid();
  return body;
}

export function createStudentAiRoutes({ query = defaultQuery, env = process.env, client,
  buildContext, answerQuestion, clock = () => new Date(), deadlineMs = 120000,
  providerTimeoutMs = 60000, maxConcurrent = 2, maxPerUser = 1,
  countTokens, maxInputTokens = 100000, maxOutputTokens = 2000 } = {}) {
  positiveLimit(deadlineMs, 120000); positiveLimit(providerTimeoutMs, 60000);
  positiveLimit(maxConcurrent, 2); positiveLimit(maxPerUser, 1);
  positiveLimit(maxInputTokens, 100000); positiveLimit(maxOutputTokens, 2000);
  const app = new Hono();
  const users = new Map(); let active = 0, services;
  const getServices = () => {
    if (services) return services;
    if (buildContext && answerQuestion) return { buildContext, answerQuestion };
    const config = readStudentAiConfig(client ? { ...env, OPENAI_API_KEY: 'injected-client' } : env);
    const ai = client ?? createStudentAiClient(config);
    services = {
      buildContext: buildContext ?? createStudentAiContextService({ query,
        select: createStudentAiSelector({ client: ai, model: config.selectionModel,
          countTokens, maxInputTokens, timeoutMs: providerTimeoutMs }) }),
      answerQuestion: answerQuestion ?? createStudentAiAnswerService({ client: ai, model: config.answerModel,
        countTokens, maxInputTokens, maxOutputTokens, timeoutMs: providerTimeoutMs })
    };
    return services;
  };
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  app.use('*', createRequireAuth({ query }));
  app.onError((_, c) => reject(c, 500));
  app.post('/:studentId/questions', async c => {
    if (!['admin', 'leader', 'crew'].includes(c.get('user').role)) return reject(c, 403);
    if (env.STUDENT_AI_ENABLED !== 'true') return reject(c, 503);
    try {
      const body = await requestBody(c);
      const studentId = c.req.param('studentId');
      if (!studentId.trim() || Array.from(studentId).length > 128 || /[\x00-\x1f]/.test(studentId)) invalid();
      const userId = c.get('user').id;
      if (active >= maxConcurrent || (users.get(userId) ?? 0) >= maxPerUser) return reject(c, 429);
      active++; users.set(userId, (users.get(userId) ?? 0) + 1);
      const controller = new AbortController();
      let expire;
      const deadline = new Promise((_, rejectDeadline) => {
        expire = () => { controller.abort(); rejectDeadline(new Error('AI_DEADLINE')); };
      });
      const timer = setTimeout(expire, deadlineMs);
      c.req.raw.signal.addEventListener('abort', expire, { once: true });
      if (c.req.raw.signal.aborted) expire();
      const worker = (async () => {
        try {
          checkAbort(controller.signal);
          const { buildContext: build, answerQuestion: answer } = getServices();
          const now = new Date(clock().getTime() + 9 * 3600000).toISOString().slice(0, 10);
          const input = { studentId, question: body.question, compareAt: body.compareAt, now, signal: controller.signal };
          const context = await build(input);
          checkAbort(controller.signal);
          if (context.studentId !== studentId) throw new Error('STUDENT_SCOPE_VIOLATION');
          const result = await answer({ ...input, context });
          checkAbort(controller.signal);
          return result;
        } finally {
          // This runs on actual worker settlement, not merely on timeout response.
          active--;
          const remaining = users.get(userId) - 1;
          if (remaining) users.set(userId, remaining); else users.delete(userId);
        }
      })();
      try {
        return c.json({ success: true, data: await Promise.race([worker, deadline]) });
      } finally {
        clearTimeout(timer);
        c.req.raw.signal.removeEventListener('abort', expire);
      }
    } catch (error) { return reject(c, errorStatus.get(error.message) ?? 500); }
  });
  return app;
}

export default createStudentAiRoutes();
