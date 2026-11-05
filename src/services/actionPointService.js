import { query } from '../db/connection.js';
import { fetchSatisfactionFromCache } from './cacheService.js';
import { fetchStudentBroadcastInfo, getSheets } from './sheetsService.js';
import { ACTION_RULES, actionMonth, actionPeriods, summarizeActionPoints } from './actionPointRules.js';
import { readLearningActivity, readActionConversation, evaluateActionConversation, readSocialActivity } from './actionPointSources.js';
import { ensureActionPointSchema } from './actionPointSchema.js';

const normalize = value => String(value || '').trim().toUpperCase();
const monthOf = value => String(value || '').replace(/\//g, '-').replace(/^(\d{4})-(\d)$/, '$1-0$2');
const safeRead = async fn => { try { return await fn(); } catch { return null; } };
let running;
let job = { running: false, result: null };

export function createActionPointService(deps = {}) {
  const db = deps.query || query;
  const ensureSchema = deps.ensureSchema || (deps.query ? async () => {} : ensureActionPointSchema);
  const learning = deps.learning || readLearningActivity;
  const conversation = deps.conversation || readActionConversation;
  const grade = deps.grade || evaluateActionConversation;
  const social = deps.social || readSocialActivity;
  const satisfaction = deps.satisfaction || (async () => {
    const id = process.env.GOOGLE_CACHE_SHEET_ID || process.env.GOOGLE_SHEET_ID;
    if (!id) throw new Error('Cache is not configured');
    return fetchSatisfactionFromCache(id);
  });
  const contacts = deps.contacts || fetchStudentBroadcastInfo;
  const wanami = deps.wanami || (async () => {
    const response = await getSheets().spreadsheets.values.batchGet({ spreadsheetId: '1vKrYCzaw-miJOY52oskNoMfn-uEHIolBMhC7uMxxN_M', ranges: ["'Q&A記録'!A2:A", "'Q&A記録'!O2:O"] });
    const [dates, ids] = response.data.valueRanges || [];
    if (!dates || !ids) throw new Error('Usage source is unavailable');
    return (dates.values || []).map((row, i) => [row[0], ...Array(13).fill(''), ids.values?.[i]?.[0]]);
  });

  async function snapshotTutors(now = new Date()) {
    // A missing month-end is left missing. Never backfill it with next month's assignment.
    const tomorrow = actionMonth(new Date(now.getTime() + 86400000));
    if (tomorrow === actionMonth(now)) return { captured: 0 };
    await ensureSchema();
    const result = await db(`INSERT INTO action_point_tutor_snapshots (year_month, student_id, tutor_name, captured_at)
      SELECT $1, student_id, NULLIF(TRIM(homeroom_tutor), ''), $2 FROM students
      ON CONFLICT (year_month, student_id) DO UPDATE SET tutor_name = EXCLUDED.tutor_name, captured_at = EXCLUDED.captured_at`, [actionMonth(now), now]);
    return { captured: result.rowCount };
  }

  async function updateAll(yearMonth = null, now = new Date(), onlyStudent = null) {
    const p = actionPeriods(now);
    // Rolling chat/video windows are only meaningful for the current month.
    if (yearMonth && yearMonth !== p.month) throw new Error('Only the current month can be recalculated');
    await ensureSchema();
    const students = (await db("SELECT student_id, homeroom_tutor, lesson_start_date, x_account_id, youtube_channel_id FROM students WHERE status = 'アクティブ' AND ($1::text IS NULL OR student_id=$1) ORDER BY student_id", [onlyStudent])).rows;
    const reports = (await db(`SELECT student_id,
      COUNT(*) FILTER (WHERE lesson_date >= $2 AND lesson_result = '無断キャンセル')::int AS absence,
      COUNT(*) FILTER (WHERE lesson_date >= $2 AND lesson_result = '生徒様都合でリスケ')::int AS reschedule,
      COUNT(*) FILTER (WHERE lesson_date < $2 AND lesson_result = '実施済み')::int AS completed
      FROM lesson_reports WHERE lesson_date >= $1 AND lesson_date < $3 GROUP BY student_id`,
    [`${p.previous}-01`, `${p.month}-01`, new Date(Date.UTC(Number(p.month.slice(0, 4)), Number(p.month.slice(5)), 1)).toISOString().slice(0, 10)])).rows;
    const reservations = (await db(`SELECT student_id, COUNT(*)::int AS count FROM lessons
      WHERE TO_CHAR(lesson_date, 'YYYY-MM') = $1 GROUP BY student_id`, [p.month])).rows;
    const snapshots = (await db('SELECT student_id, tutor_name FROM action_point_tutor_snapshots WHERE year_month = $1', [p.previous])).rows;
    const previous = (await db('SELECT student_id, payload, updated_at FROM action_point_results WHERE year_month = $1', [p.month])).rows;
    const legacyLocks = (await db('SELECT student_id, reservation_locked, reservation_score FROM red_list WHERE year_month = $1 AND reservation_locked = TRUE', [p.month])).rows;
    const [answers, uses, people, views] = await Promise.all([
      safeRead(satisfaction), safeRead(wanami), safeRead(contacts), safeRead(learning)
    ]);
    const index = rows => new Map((rows || []).map(row => [normalize(row.student_id || row.studentId), row]));
    const reportMap = index(reports), reservationMap = index(reservations), snapshotMap = index(snapshots), oldMap = index(previous);
    const peopleMap = index(people), viewMap = index(views), legacyLockMap = index(legacyLocks);
    const answerMap = new Map();
    const invalidAnswerTimes = new Set();
    for (const answer of answers || []) {
      const key = `${normalize(answer.student_id)}:${monthOf(answer.year_month)}`;
      if (!Number.isFinite(new Date(answer.timestamp).getTime())) invalidAnswerTimes.add(key);
      const old = answerMap.get(key);
      if (!old || !Number.isFinite(new Date(old.timestamp).getTime()) || new Date(answer.timestamp) >= new Date(old.timestamp)) answerMap.set(key, answer);
    }
    const useSet = new Set((uses || []).filter(row => Number.isFinite(new Date(row[0]).getTime()) && actionMonth(new Date(row[0])) === p.previous).map(row => normalize(row[14])));
    let updated = 0, errors = 0;
    for (const student of students) {
      try {
        const id = normalize(student.student_id), report = reportMap.get(id) || { absence: 0, reschedule: 0, completed: 0 };
        const old = oldMap.get(id), prior = old?.payload;
        const items = ACTION_RULES.map(rule => ({ ...rule, status: 'unknown', point: null, reason: 'データ未取得', evidence: [] }));
        const set = (key, point, reason, status = 'evaluated', evidence = []) => Object.assign(items.find(item => item.key === key), { point: status === 'evaluated' ? Number(Boolean(point)) : null, status, reason, evidence });
        const completed = Number(report.completed);
        const started = student.lesson_start_date && new Date(student.lesson_start_date) < p.start;
        set('absence', Number(report.absence) > 0, `当月 ${report.absence}回`);
        set('reschedule', Number(report.reschedule) > 0, `当月 ${report.reschedule}回`);
        set('attendance', completed < 2, `前月 ${completed}/2回`, started ? 'evaluated' : 'exempt');
        if (answers) {
          const answer = answerMap.get(`${id}:${p.month}`);
          const value = Number(answer?.satisfaction_score);
          if (answer && !invalidAnswerTimes.has(`${id}:${p.month}`) && answer.satisfaction_score !== null && Number.isFinite(value) && value >= 1 && value <= 10) set('satisfaction', value <= 7, `当月最新回答 ${value}点`);
          set('survey', !answerMap.has(`${id}:${p.previous}`), completed ? '前月の実施者を対象に回答有無を確認' : '前月に実施済みレッスンなし', completed ? 'evaluated' : 'exempt');
        }
        if (uses) set('wanami', !useSet.has(id), '前月のQ&A記録で判定', started ? 'evaluated' : 'exempt');
        const day = Number(new Date(now.getTime() + 9 * 3600000).toISOString().slice(8, 10));
        const locked = prior?.items?.find(item => item.key === 'reservation' && item.status === 'evaluated');
        if (locked) Object.assign(items.find(item => item.key === 'reservation'), locked);
        else if (legacyLockMap.has(id)) set('reservation', Number(legacyLockMap.get(id).reservation_score) > 0, '旧方式で確定済みの当月予約不足判定を引き継ぎ（各1Pt）');
        else if (day >= 10) set('reservation', Number(reservationMap.get(id)?.count || 0) < 2, `10日以降の初回判定時 ${reservationMap.get(id)?.count || 0}回（固定）`);
        else set('reservation', false, '10日から判定', 'exempt');
        const snapshot = snapshotMap.get(id);
        if (snapshot) {
          const before = String(snapshot.tutor_name || '').trim(), current = String(student.homeroom_tutor || '').trim();
          set('handover', !!before && !!current && before !== current, !before ? '前月末は担当未設定（初回割り振り対象外）' : '前月末と現在の担当を比較', !current ? 'exempt' : 'evaluated');
        } else set('handover', false, '前月末の担当Tutor履歴なし（過去の担当は推測しません）', 'unknown');
        if (views && viewMap.has(id)) {
          const at = viewMap.get(id).last_watched_at;
          set('video', !at || new Date(at) < p.fourteen, at ? `最終視聴 ${new Date(at).toISOString()}` : 'アカウントあり・視聴履歴なし', student.lesson_start_date && new Date(student.lesson_start_date) > p.fourteen ? 'exempt' : 'evaluated');
        }
        set('mission', false, '課題・完了実績の連携待ち', 'unknown');
        const fresh = prior?.external_evaluated_at && new Date(now) - new Date(prior.external_evaluated_at) < 86400000;
        if (fresh) {
          // Daily external reads and AI calls are reused across manual updates.
          for (const key of ['chat_frequency', 'chat_quality', 'dependency', 'youtube']) {
            const saved = prior?.items?.find(item => item.key === key);
            if (saved) Object.assign(items.find(item => item.key === key), saved);
          }
        } else {
          const info = peopleMap.get(id);
          const messages = info && await safeRead(() => conversation(info, p.thirty, now));
          if (messages) {
            const own = messages.filter(m => m.authorId === info.discordId);
            set('chat_frequency', !own.some(m => new Date(m.at) >= p.fourteen), '直近14日間の本人投稿を確認', student.lesson_start_date && new Date(student.lesson_start_date) > p.fourteen ? 'exempt' : 'evaluated');
            if (own.length < 2) {
              for (const key of ['chat_quality', 'dependency']) set(key, false, '本人の投稿が少なく判断材料不足', 'unknown');
            } else {
              const evaluation = await safeRead(() => grade(messages, info.discordId));
              if (evaluation) for (const key of ['chat_quality', 'dependency']) {
                const item = evaluation[key];
                set(key, item.point, item.sufficient ? `独立した該当場面 ${item.incidents.length}件` : 'AI判断材料不足', item.sufficient ? 'evaluated' : 'unknown', item.incidents);
              }
            }
          }
        }
        // X has an independent persistent weekly cache, also across month rollover.
        const activity = await safeRead(() => social(student, p, now, { xOnly: Boolean(fresh) }));
        if (!fresh && typeof activity?.youtube === 'boolean') set('youtube', activity.youtube, '公開動画の期間内実績で判定');
        if (typeof activity?.x === 'boolean') set('x', activity.x,
          `X取得は最短7日間隔。取得確認：${activity.xCheckedAt ? new Date(activity.xCheckedAt).toISOString() : '－'}／最終投稿：${activity.xLastPostAt ? new Date(activity.xLastPostAt).toISOString() : '期間内なし'}`);
        const result = { ...summarizeActionPoints(items), version: 1, evaluated_at: now.toISOString(), external_evaluated_at: fresh ? prior.external_evaluated_at : now.toISOString() };
        // Keep correspondence/assignment/message history and legacy monthly archiving intact.
        const score = key => items.find(item => item.key === key).point || 0;
        await db(`WITH saved AS (INSERT INTO action_point_results (student_id, year_month, payload, updated_at)
          VALUES ($1::text,$2::text,$10::jsonb,$11::timestamptz)
          ON CONFLICT (student_id, year_month) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at RETURNING student_id)
          INSERT INTO red_list (student_id, year_month, satisfaction_score, absence_score, survey_score, reschedule_score, reservation_score, total_score, rank)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (student_id, year_month) DO UPDATE SET
          satisfaction_score=$3, absence_score=$4, survey_score=$5, reschedule_score=$6, reservation_score=$7, total_score=$8, rank=$9, updated_at=CURRENT_TIMESTAMP`,
        [student.student_id, p.month, score('satisfaction'), score('absence'), score('survey'), score('reschedule'), score('reservation'), result.total, result.rank === 'unknown' ? 'none' : result.rank, result, now]);
        updated++;
      } catch { errors++; console.error('[Action Points] Student evaluation failed'); }
    }
    return { updated, errors };
  }

  async function getAll(yearMonth = actionMonth()) {
    await ensureSchema();
    const { rows } = await db(`SELECT r.*, s.student_id, s.name AS student_name, s.homeroom_tutor,
      a.year_month, a.payload AS action_points, a.updated_at AS action_evaluated_at
      FROM students s LEFT JOIN action_point_results a ON a.student_id=s.student_id AND a.year_month=$1
      LEFT JOIN red_list r ON r.student_id=s.student_id AND r.year_month=$1
      WHERE s.status='アクティブ' ORDER BY s.student_id`, [yearMonth || actionMonth()]);
    return rows.map(row => {
      const result = row.action_points || summarizeActionPoints(ACTION_RULES.map(rule => ({ ...rule, status: 'unknown', point: null, reason: '新方式で未評価', evidence: [] })));
      return { ...row, year_month: yearMonth || actionMonth(), action_points: result, total_score: result.total, rank: result.rank };
    });
  }
  return { updateAll, snapshotTutors, getAll };
}

const service = createActionPointService();
export function updateAllRedLists(yearMonth = null, { background = false } = {}) {
  if (yearMonth && yearMonth !== actionMonth()) return Promise.reject(new Error('Only the current month can be recalculated'));
  if (!running) {
    job = { running: true, result: null };
    running = service.updateAll(yearMonth).then(result => { job.result = result; return result; })
      .catch(error => { job.result = { failed: true }; console.error('[Action Points] Batch evaluation failed'); throw new Error('Action point evaluation failed'); })
      .finally(() => { running = null; job.running = false; });
    // The background job has a handler even after the HTTP request has ended.
    running.catch(() => {});
  }
  return background ? Promise.resolve({ running: true }) : running;
}
export const getActionPointJobStatus = () => ({ ...job });
export const getAllRedLists = service.getAll;
export const snapshotActionPointTutors = service.snapshotTutors;
export async function getRedList(studentId, yearMonth) {
  return (await service.getAll(yearMonth)).find(row => row.student_id === studentId) || null;
}
export async function calculateRedListScore(studentId, yearMonth) {
  return (await getRedList(studentId, yearMonth))?.action_points || { total: 0, rank: 'unknown' };
}
export async function updateRedList(studentId, yearMonth) {
  if (running) await running;
  await service.updateAll(yearMonth, new Date(), studentId);
  return calculateRedListScore(studentId, yearMonth);
}
