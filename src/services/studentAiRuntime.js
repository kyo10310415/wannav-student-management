import OpenAI from 'openai';
import pg from 'pg';

export const checkAbort = signal => {
  if (signal?.aborted) throw new Error('AI_DEADLINE');
};

export function positiveLimit(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('AI_CONFIG');
  return value;
}

// A pinned, non-reasoning Chat Completions model; other models need budget/API review.
const MODELS = new Set(['gpt-4.1-mini-2025-04-14', 'gpt-4.1-mini']);
export function readStudentAiConfig(env = process.env) {
  const selectionModel = env.STUDENT_AI_SELECTION_MODEL || 'gpt-4.1-mini-2025-04-14';
  const answerModel = env.STUDENT_AI_ANSWER_MODEL || 'gpt-4.1-mini-2025-04-14';
  if (!MODELS.has(selectionModel) || !MODELS.has(answerModel) || !env.OPENAI_API_KEY?.trim()) throw new Error('AI_CONFIG');
  return { selectionModel, answerModel, apiKey: env.OPENAI_API_KEY };
}

export function createStudentAiClient(config) {
  return new OpenAI({ apiKey: config.apiKey, maxRetries: 0, timeout: 60000, logLevel: 'off' });
}

// Do not use connection.query: it logs raw provider/DB messages on failure.
// This dedicated lazy pool also avoids the shared pool's raw idle-error logger.
export function createStudentAiQuery({ poolFactory = options => new pg.Pool(options), env = process.env } = {}) {
  let pool;
  return async (sql, params) => {
    try {
      if (!pool) {
        pool = poolFactory({
          connectionString: env.DATABASE_URL,
          ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
          max: 2, connectionTimeoutMillis: 5000, statement_timeout: 60000,
          options: '-c default_transaction_read_only=on'
        });
        pool.on('error', () => { /* pg removes failed idle clients; never log their error payload. */ });
      }
      return await pool.query(sql, params);
    } catch { throw new Error('AI_DATABASE_ERROR'); }
  };
}

// Abort both on the overall deadline and the per-call timeout. Await actual
// settlement so the route cannot release its concurrency slot while work runs.
export async function callStudentAi(client, body, { signal, timeoutMs = 60000 } = {}) {
  positiveLimit(timeoutMs, 60000);
  checkAbort(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const result = await client.chat.completions.create(body,
      { signal: controller.signal, timeout: timeoutMs, maxRetries: 0 });
    checkAbort(controller.signal);
    return result;
  } catch {
    if (controller.signal.aborted || signal?.aborted) throw new Error('AI_DEADLINE');
    throw new Error('AI_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
