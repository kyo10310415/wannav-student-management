import { getSheets } from './sheetsService.js';
import { query } from '../db/connection.js';

const FORM_ID = '15L2DRirF1cdxtHq9VSHcWUs3mSOx2i6ZOE2Mj-aOgTg';
const normalizeId = value => String(value || '').normalize('NFKC').trim().toUpperCase();
export function buildProCurricula(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = normalizeId(row[0]);
    if (id) map.set(id, String(row[1] || '').split(/[,，]/).map(s => s.trim()).filter(Boolean));
  }
  return map;
}

export function createProAssignmentLoader({ db = query, sheets = getSheets, request = fetch, env = process.env, now = () => new Date() } = {}) {
  let cached, pending, generation = 0;
  const load = async () => {
    const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(now());
    if (cached?.month === month && Date.now() - cached.at < 60000) return cached.value;
    if (pending) return pending;
    const startedGeneration = generation;
    pending = Promise.resolve().then(async () => {
      const token = env.EXTENSION_TARGETS_READ_TOKEN;
      const url = new URL(env.EXTENSION_TARGETS_API_URL);
      if (!token || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/monthly-targets/current') throw new Error('Invalid PRO target configuration');
      url.pathname = '/api/monthly-targets/pro-assignments';
      const [response, form] = await Promise.all([
        request(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000), redirect: 'error' }),
        sheets().spreadsheets.values.get({ spreadsheetId: FORM_ID, range: "'PROプランお申し込みフォーム回答'!D2:E" }),
      ]);
      if (!response.ok) throw new Error('PRO targets unavailable');
      const targets = await response.json();
      if (!targets.success || targets.month !== month || !Array.isArray(targets.data) || targets.data.some(s => typeof s.studentId !== 'string')) throw new Error('Invalid PRO targets');
      const unique = new Map(targets.data.map(s => [normalizeId(s.studentId), s]));
      const ids = [...unique.keys()];
      const result = ids.length ? await db(`SELECT s.*,COALESCE(ha.handover_tutor_name,'') AS handover_tutor_name
        FROM students s LEFT JOIN handover_assignments ha ON ha.student_id=s.student_id
        WHERE s.student_id = ANY($1::text[]) ORDER BY s.student_id`, [ids]) : { rows: [] };
      const students = new Map(result.rows.map(s => [normalizeId(s.student_id), s]));
      const curricula = buildProCurricula(form.data.values || []);
      const data = [...unique].map(([id, s]) => ({
        student_id: id, name: s.name || '', homeroom_tutor: s.tutor || '', contract_plan: s.plan || '',
        lesson_start_date: s.lessonStartDate || null, notion_url: s.notionUrl || '', discord_url: '', handover_tutor_name: '',
        ...students.get(id), can_assign: students.has(id), desired_curricula: curricula.get(id) || [],
      }));
      const value = { success: true, month, data };
      if (generation === startedGeneration) cached = { month, at: Date.now(), value };
      return value;
    }).finally(() => { pending = null; });
    return pending;
  };
  load.clear = () => { cached = null; generation++; };
  return load;
}

export const loadProAssignments = createProAssignmentLoader();
