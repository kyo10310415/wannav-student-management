import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { browserSecurityHeaders } from '../src/security/browserHeaders.js';
import { installApiAccess } from '../src/security/apiAccess.js';
function fixture() {
  const app = new Hono(); app.use('*', browserSecurityHeaders); app.use('*', cors());
  installApiAccess(app, { db: async () => ({ rows: [] }) });
  app.use('/*', serveStatic({ root: './public' }));
  app.get('/', c => c.html('<script src="https://cdn.example.invalid/fixture.js"></script>'));
  app.get('/health', c => c.json({ status: 'ok' }));
  app.get('/api/fixture', c => c.json({ private: true }));
  app.get('/error', () => { throw Error('fixture'); });
  app.onError((_error, c) => c.json({ error: 'fixed' }, 500));
  return app;
}
function protectedResponse(response) {
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('Strict-Transport-Security'), 'max-age=86400');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  const csp = response.headers.get('Content-Security-Policy');
  for (const directive of ["base-uri 'self'", "form-action 'self'", "object-src 'none'", "frame-ancestors 'none'"]) assert.equal(csp.includes(directive), true);
  assert.equal(/(?:default|script|style|connect|img|font)-src/.test(csp), false);
  for (const name of ['Cross-Origin-Opener-Policy','Cross-Origin-Embedder-Policy','Cross-Origin-Resource-Policy','Report-To','Reporting-Endpoints','Content-Security-Policy-Report-Only','Permissions-Policy']) assert.equal(response.headers.has(name), false, name);
}
test('HTML health denial errors and missing pages all retain protective headers and expected statuses', async () => {
  const app = fixture();
  for (const [path, status] of [['/', 200], ['/health', 200], ['/api/fixture', 401], ['/missing-fixture', 404], ['/error', 500]]) {
    const response = await app.request(path); assert.equal(response.status, status, path); protectedResponse(response);
  }
});
test('real static JavaScript and HTML retain browser-compatible MIME types and bodies', async () => {
  const app = fixture();
  for (const path of ['/app.js', '/extension-review.js']) {
    const response = await app.request(path); assert.equal(response.status, 200); protectedResponse(response);
    assert.match(response.headers.get('Content-Type'), /(?:application|text)\/javascript/);
    assert.equal((await response.text()).length > 0, true);
  }
  const html = await app.request('/roulette.html'); assert.equal(html.status, 200); protectedResponse(html); assert.match(html.headers.get('Content-Type'), /text\/html/);
});
test('CORS preflight and HEAD retain existing contracts with protective headers', async () => {
  const app = fixture();
  const preflight = await app.request('/api/fixture', { method: 'OPTIONS', headers: { Origin: 'https://fixture.example.invalid', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*'); protectedResponse(preflight);
  const head = await app.request('/', { method: 'HEAD' }); assert.equal(head.status, 200); protectedResponse(head); assert.equal(await head.text(), '');
});
test('production entry installs browser headers before CORS authentication and static serving', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const position = source.indexOf("app.use('*', browserSecurityHeaders)");
  assert.equal(position > 0, true);
  for (const target of ["app.use('*', cors())", 'configureInternalApi(installApiAccess', "app.use('/*', serveStatic"]) assert.equal(source.indexOf(target) > position, true);
});

test('migrated static pages block inline scripts and handlers without restricting other pages', async () => {
  const app = fixture();
  for (const path of ['/funnel-analysis-export.html', '/redlist-update.html']) {
    const response = await app.request(path + '?fixture=1');
    assert.equal(response.status, 200);
    const csp = response.headers.get('Content-Security-Policy');
    assert.match(csp, /script-src-elem 'self'/);
    assert.match(csp, /script-src-attr 'none'/);
    assert.equal(csp.includes('https://cdn.tailwindcss.com'), path === '/redlist-update.html');
    assert.equal(/unsafe-inline|unsafe-eval/.test(csp), false);
    const head = await app.request(path, { method: 'HEAD' });
    assert.equal(head.headers.get('Content-Security-Policy'), csp);
  }
  for (const path of ['/redlist-update.js', '/funnel-analysis-export.js']) {
    const response = await app.request(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /javascript/);
    protectedResponse(response);
  }
  for (const path of ['/%66unnel-analysis-export.html', '/%72edlist-update.html']) {
    const response = await app.request('http://localhost' + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('Content-Security-Policy'), /script-src-attr 'none'/, path);
  }
  assert.equal((await app.request('http://localhost//redlist-update.html')).status, 404);
  protectedResponse(await app.request('/roulette.html'));
});
