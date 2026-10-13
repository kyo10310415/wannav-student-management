import { randomUUID } from 'node:crypto';
import { query, getClient } from '../db/connection.js';
import { fetchReviewTranscript } from './driveService.js';
import { fetchReviewNotion } from './extensionReviewSources.js';
import { gradeExtensionReview } from './extensionReviewAI.js';
import { DEFAULT_REVIEW_SETTINGS, parseReviewUrl, reviewError, validateReviewSettings,
  DEFAULT_REVIEW_MAPPING, targetMatch, reviewFingerprint, estimateReviewCost, reviewMarkdown, validateReviewResult, resolveReviewSpeakers } from './extensionReviewRules.js';

export function createExtensionReviewService({ db = query, connect = getClient, readNotion = fetchReviewNotion,
  readDoc = fetchReviewTranscript, grade = gradeExtensionReview,
  model = () => process.env.OPENAI_EXTENSION_REVIEW_MODEL || 'gpt-6-sol' } = {}) {
  async function settings(id) {
    if (id && !/^\d+$/.test(String(id))) throw reviewError('基準バージョンが不正です');
    const rows = await db(`SELECT * FROM extension_review_settings ${id ? 'WHERE id = $1' : ''} ORDER BY id DESC LIMIT 1`, id ? [id] : []);
    const row = rows.rows[0] || { id: null, config: structuredClone(DEFAULT_REVIEW_SETTINGS) };
    if (!row.config.mapping || Object.keys(row.config.mapping).length === 0) return { ...row, config: { ...row.config, mapping: structuredClone(DEFAULT_REVIEW_MAPPING) } };
    return row;
  }
  function output(row, config) {
    if (!row) throw reviewError('採点結果が見つかりません', 404);
    const result = row.edited_result || row.ai_result;
    return { ...row, result, markdown: result ? reviewMarkdown(result, row.profile, row.target_match, config?.template || '') : null };
  }
  async function get(id) {
    const row = (await db(`SELECT r.*, s.config FROM extension_reviews r JOIN extension_review_settings s ON s.id = r.settings_id WHERE r.id = $1`, [id])).rows[0];
    return output(row, row?.config);
  }
  async function tutors() {
    return (await db(`SELECT DISTINCT t.employee_id, t.tutor_name, t.notion_name, t.name FROM tutors t
      JOIN users u ON LOWER(u.email) = LOWER(t.email)
      WHERE t.status = 'アクティブ' AND COALESCE(u.job_title, '') <> '契約解除'
      AND t.job_type LIKE '%Tutor%' ORDER BY t.tutor_name`)).rows;
  }
  async function generate(input, user) {
    if (input.force !== undefined && typeof input.force !== 'boolean') throw reviewError('再採点指定が不正です');
    if (!Number.isInteger(input.round) || input.round < 1 || input.round > 4 || typeof input.tutorId !== 'string' || input.tutorId.length > 100) throw reviewError('審査回数・実施Tutorを選択してください');
    if (input.force && input.regradeConfirmed !== true) throw reviewError('再採点には追加料金の確認が必要です');
    const notionId = parseReviewUrl(input.notionUrl, 'notion'), documentId = parseReviewUrl(input.documentUrl, 'docs');
    const version = await settings();
    if (!version.id || !version.config.criteria.trim() || !version.config.scripts[input.round - 1]?.trim()) throw reviewError('採点基準と対象回数のスクリプトを管理者が登録してください', 409);
    validateReviewSettings(version.config);
    const tutor = (await tutors()).find(t => t.employee_id === input.tutorId);
    if (!tutor) throw reviewError('選択した実施Tutorを確認してください');
    const source = await readNotion(notionId, version.config.mapping);
    const sourceId = source.studentId === null || source.studentId === undefined ? '' : String(source.studentId).trim().toUpperCase();
    const students = (await db(`SELECT student_id, name FROM students WHERE
      LOWER(REPLACE(notion_page_id, '-', '')) = $1 OR UPPER(TRIM(student_id)) = $2`, [notionId.replaceAll('-', ''), sourceId])).rows;
    if (students.length !== 1 || sourceId && sourceId !== students[0].student_id.trim().toUpperCase()) throw reviewError('Notionページと登録済み生徒の対応を確認してください');
    const student = students[0];
    const document = await readDoc(documentId);
    if (!document.text?.trim()) throw reviewError('文字起こしが空です');
    if (document.text.length > version.config.limits.maxTranscriptChars) throw reviewError('文字起こしが上限を超えています。切り捨てて採点はしません', 413);
    const aliases = Object.hasOwn(version.config.speakerAliases || {}, tutor.employee_id) ? version.config.speakerAliases[tutor.employee_id] : [];
    const speakerLabels = resolveReviewSpeakers(document.text, [tutor.tutor_name,tutor.notion_name,tutor.name,...aliases]);
    const aiModel = model();
    const fingerprint = reviewFingerprint({ notionId, documentId, transcript: document.text, profile: source.profile,
      tutorId: tutor.employee_id, speakerLabels, round: input.round, version: version.id, model: aiModel });
    const connection = await connect();
    let locked = false;
    try {
      locked = (await connection.query('SELECT pg_try_advisory_lock(581301) AS locked')).rows[0].locked;
      if (!locked) throw reviewError('別の採点が実行中です。完了後にお試しください', 429);
      if (!input.force) {
        const existing = (await connection.query(`SELECT * FROM extension_reviews WHERE fingerprint = $1 AND state = 'succeeded' ORDER BY created_at DESC LIMIT 1`, [fingerprint])).rows[0];
        if (existing) return { ...output(existing, version.config), reused: true };
      }
      const counts = (await connection.query(`SELECT
        COUNT(*) FILTER (WHERE created_at >= (DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo'))::int AS monthly,
        COUNT(*) FILTER (WHERE created_by = $1 AND created_at >= NOW() - INTERVAL '1 hour')::int AS user_hour
        FROM extension_reviews`, [user.id])).rows[0];
      if (counts.monthly >= version.config.limits.monthlyCalls || counts.user_hour >= 10) throw reviewError('採点件数の上限に達しました', 429);
      const id = randomUUID(), match = targetMatch(source.profile, version.config.target);
      await connection.query(`INSERT INTO extension_reviews
        (id, created_by, round, student_id, student_name, tutor_id, tutor_name, notion_page_id, document_id,
         fingerprint, settings_id, model, profile, target_match, speaker_labels)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb)`,
      [id, user.id, input.round, student.student_id, student.name, tutor.employee_id, tutor.tutor_name,
        notionId, documentId, fingerprint, version.id, aiModel, JSON.stringify(source.profile), JSON.stringify(match), JSON.stringify(speakerLabels)]);
      try {
        const evaluation = await grade({ transcript: document.text, config: version.config, round: input.round, model: aiModel, tutorName: tutor.tutor_name, speakerLabels });
        const cost = estimateReviewCost(evaluation.usage, version.config.prices);
        // Validate again at the persistence boundary, even when an injected client is used.
        validateReviewResult(evaluation.result, document.text, speakerLabels);
        const row = (await connection.query(`UPDATE extension_reviews SET state = 'succeeded', ai_result = $2::jsonb,
          usage = $3::jsonb, estimated_cost = $4 WHERE id = $1 RETURNING *`,
        [id, JSON.stringify(evaluation.result), JSON.stringify(evaluation.usage), cost])).rows[0];
        return { ...output(row, version.config), reused: false };
      } catch (error) {
        const safeMessage = error.safe ? error.message : '採点処理に失敗しました';
        await connection.query(`UPDATE extension_reviews SET state = 'failed', safe_error = $2,
          usage = $3::jsonb, estimated_cost = $4 WHERE id = $1`, [id, safeMessage,
          JSON.stringify(error.apiUsage || null), estimateReviewCost(error.apiUsage, version.config.prices)]);
        throw reviewError(safeMessage, error.status || 502);
      }
    } finally {
      try { if (locked) await connection.query('SELECT pg_advisory_unlock(581301)'); }
      finally { connection.release(); }
    }
  }
  async function saveSettings(config, user) {
    validateReviewSettings(config);
    // Validate custom template independently of grading availability.
    if (config.template.trim() && !['grading','script','profile','factors'].every(k => config.template.includes(`{{${k}}}`))) throw reviewError('テンプレートには{{grading}} {{script}} {{profile}} {{factors}}が必要です');
    return (await db('INSERT INTO extension_review_settings(config, created_by) VALUES ($1::jsonb, $2) RETURNING *', [JSON.stringify(config), user.id])).rows[0];
  }
  async function edit(id, result, user) {
    if (user.role !== 'admin') throw reviewError('管理者のみ編集できます', 403);
    try { validateReviewResult(result); } catch (error) { throw reviewError(error.safe ? error.message : '編集内容が不正です'); }
    const connection = await connect();
    try {
      await connection.query('BEGIN');
      const row = (await connection.query('SELECT * FROM extension_reviews WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!row || row.state !== 'succeeded') throw reviewError('編集できる採点結果が見つかりません', 404);
      if (row.confirmed_at) throw reviewError('確定済みの採点結果は変更できません', 409);
      await connection.query('INSERT INTO extension_review_edits(review_id, result, edited_by) VALUES ($1,$2::jsonb,$3)', [id, JSON.stringify(result), user.id]);
      await connection.query('UPDATE extension_reviews SET edited_result = $2::jsonb, reviewed_by = NULL, reviewed_at = NULL WHERE id = $1', [id, JSON.stringify(result)]);
      await connection.query('COMMIT');
      return get(id);
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }
  async function review(id, user, confirm = false) {
    if (confirm && user.role !== 'admin') throw reviewError('管理者のみ確定できます', 403);
    const rows = await db(`UPDATE extension_reviews SET reviewed_by = $2, reviewed_at = NOW()
      ${confirm ? ', confirmed_by = $2, confirmed_at = NOW()' : ''}
      WHERE id = $1 AND state = 'succeeded' AND confirmed_at IS NULL RETURNING id`, [id, user.id]);
    if (!rows.rows.length) throw reviewError('採点結果が存在しないか、既に確定済みです', 409);
    return get(id);
  }
  async function history(filters = {}) {
    const params = [], terms = [];
    function add(expression, value) { params.push(value); terms.push(expression.replaceAll('?', `$${params.length}`)); }
    if (filters.student) add('(student_name ILIKE ? OR student_id ILIKE ?)', `%${String(filters.student).slice(0,100)}%`);
    // Both occurrences use the same parameter safely.
    if (filters.tutor) add('tutor_id = ?', String(filters.tutor).slice(0,100));
    if (filters.round) {
      if (![1,2,3,4].includes(Number(filters.round))) throw reviewError('審査回数が不正です');
      add('round = ?', Number(filters.round));
    }
    for (const [key, operator] of [['from', '>='], ['to', '<']]) {
      if (filters[key]) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || Number.isNaN(Date.parse(filters[key])) || new Date(filters[key]).toISOString().slice(0,10) !== filters[key]) throw reviewError('日付が不正です');
        add(`created_at ${operator} ((?::date::timestamp${key === 'to' ? " + INTERVAL '1 day'" : ''}) AT TIME ZONE 'Asia/Tokyo')`, filters[key]);
      }
    }
    const limit = Math.floor(Math.max(1, Math.min(100, Number(filters.limit) || 50))), offset = Math.floor(Math.max(0, Math.min(100000, Number(filters.offset) || 0)));
    const order = filters.sort === 'score' ? "COALESCE(edited_result->>'score', ai_result->>'score')::numeric DESC NULLS LAST, created_at DESC" : 'created_at DESC';
    const where = terms.length ? `WHERE ${terms.join(' AND ')}` : '';
    return (await db(`SELECT id, created_at, round, student_id, student_name, tutor_id, tutor_name, state,
      COALESCE(edited_result->>'score', ai_result->>'score')::numeric AS score, settings_id, model, usage,
      estimated_cost, reviewed_at, confirmed_at, safe_error, COUNT(*) OVER()::int AS total
      FROM extension_reviews ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params)).rows;
  }
  async function analysis() {
    const rows = (await db(`SELECT tutor_id, tutor_name, round, settings_id,
      TO_CHAR(created_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM') AS month,
      COALESCE(edited_result, ai_result) AS result, confirmed_at, usage, estimated_cost
      FROM extension_reviews WHERE state = 'succeeded' ORDER BY created_at`)).rows;
    const costs = (await db(`SELECT TO_CHAR(created_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM') AS month,
      COUNT(*)::int AS calls, COUNT(*) FILTER (WHERE state = 'failed')::int AS errors,
      SUM(estimated_cost) AS estimated_cost,
      COUNT(*) FILTER (WHERE estimated_cost IS NULL)::int AS unpriced,
      SUM(COALESCE((usage->>'input_tokens')::bigint, 0)) AS input_tokens,
      SUM(COALESCE((usage->>'output_tokens')::bigint, 0)) AS output_tokens,
      SUM(COALESCE((usage->'input_tokens_details'->>'cached_tokens')::bigint, 0)) AS cached_tokens
      FROM extension_reviews GROUP BY month ORDER BY month DESC`)).rows;
    const grouped = new Map();
    for (const row of rows) {
      const item = grouped.get(row.tutor_id) || { tutorId: row.tutor_id, tutorName: row.tutor_name, count: 0, confirmed: 0, score: 0, scriptMatch: 0, rounds: {}, months: {}, penalties: Object.create(null), improvements: Object.create(null) };
      item.count++; item.confirmed += row.confirmed_at ? 1 : 0; item.score += row.result.score; item.scriptMatch += row.result.scriptMatch.score;
      for (const [field,key] of [['rounds',row.round],['months',row.month]]) {
        const part = item[field][key] || { count: 0, score: 0 };
        part.count++; part.score += row.result.score; item[field][key] = part;
      }
      for (const field of ['penalties','improvements']) for (const point of row.result[field]) item[field][point.text] = (item[field][point.text] || 0) + 1;
      grouped.set(row.tutor_id,item);
    }
    for (const item of grouped.values()) { item.score /= item.count; item.scriptMatch /= item.count;
      for (const field of ['rounds','months']) for (const part of Object.values(item[field])) part.score /= part.count; }
    return { tutors: [...grouped.values()], costs, warning: '異なる基準バージョン・AI一次評価・管理者編集結果を含む独立した分析です。既存のTutor品質指標へ加算しません。' };
  }
  return { settings, saveSettings, get, generate, edit, review, history, analysis, tutors };
}

export const extensionReviewService = createExtensionReviewService();
