import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import minutesRoutes, { createMinutesRoutes } from '../src/routes/minutes.js';

const endpoints = [
  ['GET', '/list/OLWV260827-00'], ['GET', '/all'], ['GET', '/detail/1'],
  ['POST', '/generate', { studentId: 'OLWV260827-00', lessonDate: '2026-09-01', lessonNumber: '1' }],
  ['PUT', '/1', { generated_text: 'edited' }], ['DELETE', '/1'],
  ['GET', '/templates'], ['PUT', '/templates/1', { name: 'new', template_text: '{{summary}}' }],
];
function request(app, endpoint, token) {
  const [method, path, body] = endpoint;
  return app.request('/api/minutes' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function mount(routes) { const app = new Hono(); app.route('/api/minutes', routes); return app; }

test('production minutes router denies every unauthenticated endpoint', async () => {
  for (const endpoint of endpoints) {
    assert.equal((await request(mount(minutesRoutes), endpoint)).status, 401);
  }
});

test('expired sessions reject every endpoint before business SQL, Drive and AI', async () => {
  let sessionCalls = 0;
  const fail = () => assert.fail('Protected service must not run');
  const app = mount(createMinutesRoutes({
    query: async sql => {
      assert.match(sql, /FROM sessions/);
      assert.match(sql, /expires_at > NOW\(\)/);
      sessionCalls++;
      return { rows: [] };
    }, fetchTranscript: fail, buildMinutesResult: fail,
    getPreviousMinutesContext: fail, resolveMinutesTutor: fail,
  }));
  for (const endpoint of endpoints) assert.equal((await request(app, endpoint, 'expired')).status, 401);
  assert.equal(sessionCalls, endpoints.length);
});

for (const role of ['admin', 'leader', 'crew']) {
  test(`${role} retains list/detail/generate/edit/delete/template behavior`, async () => {
    const calls = [];
    const row = { id: 1, student_id: 'OLWV260827-00', generated_text: 'generated', transcript: 'transcript' };
    const app = mount(createMinutesRoutes({
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('FROM sessions')) return { rows: [{ user_id: 1, email: 'test@example.invalid', role }] };
        if (sql.includes('COUNT(*)')) return { rows: [{ total: '1' }] };
        if (sql.includes('FROM lesson_contents')) return { rows: [{ lesson_number: '1', title: 'lesson', content: 'content' }] };
        if (sql.includes('FROM minutes_templates')) return { rows: [{ id: 1, template_text: '{{summary}}' }] };
        return { rows: [row] };
      },
      fetchTranscript: async (student, date) => {
        assert.equal(student, row.student_id); assert.equal(date, '2026-09-01');
        calls.push({ drive: true });
        return { transcript: 'transcript', fileId: 'doc1', fileName: 'memo' };
      },
      buildMinutesResult: async params => {
        assert.equal(params.transcript, 'transcript');
        assert.equal(params.studentId, row.student_id);
        calls.push({ ai: true });
        return { generatedText: 'generated', qualityEvaluation: {} };
      },
      getPreviousMinutesContext: async () => null,
      resolveMinutesTutor: async () => ({ tutorName: 'Tutor', tutorEmployeeId: 'T1' }),
    }));
    for (const endpoint of endpoints) {
      const before = calls.length;
      const response = await request(app, endpoint, 'valid');
      assert.equal(response.status, 200, endpoint.join(' '));
      const body = await response.json();
      assert.equal(body.success, true);
      assert.match(calls[before].sql, /FROM sessions/);
      if (endpoint[1] === '/all') assert.equal(body.total, 1);
      if (endpoint[1] === '/detail/1') assert.deepEqual(body.data, row);
    }
    assert.equal(calls.filter(c => c.drive).length, 1);
    assert.equal(calls.filter(c => c.ai).length, 1);
    const insert = calls.find(c => c.sql?.includes('INSERT INTO minutes'));
    assert.match(insert.sql, /ON CONFLICT \(student_id, lesson_date\)/);
    assert.equal(insert.params[0], row.student_id);
    assert.equal(insert.params[4], 'doc1');
    assert.equal(insert.params[6], 'transcript');
    assert.ok(calls.some(c => c.sql?.includes('DELETE FROM minutes')));
  });
}

test('authenticated missing records and invalid generation retain existing errors', async () => {
  const app = mount(createMinutesRoutes({ query: async sql => ({ rows: sql.includes('FROM sessions') ? [{ user_id: 1, role: 'crew' }] : [] }) }));
  for (const endpoint of [['GET', '/detail/99'], ['PUT', '/99', { generated_text: 'x' }], ['PUT', '/templates/99', {}]]) {
    assert.equal((await request(app, endpoint, 'valid')).status, 404);
  }
  assert.equal((await request(app, ['POST', '/generate', {}], 'valid')).status, 400);
  assert.equal((await request(app, ['POST', '/generate', { studentId: 'A', lessonDate: '2026-09-01' }], 'valid')).status, 409);
});
