import test from 'node:test';
import assert from 'node:assert/strict';
import { google } from 'googleapis';

test('Sheets service preserves array queries and OAuth refresh with the real SDK and qs serializer', async () => {
  const previousCredentials = process.env.GOOGLE_CREDENTIALS_JSON;
  const originalGetClient = google.auth.GoogleAuth.prototype.getClient;
  const calls = [];
  const oauth = new google.auth.OAuth2('fixture-client', 'fixture-client-secret', 'https://fixture.example/auth/callback');
  oauth.setCredentials({ refresh_token: 'fixture-refresh-token', expiry_date: Date.now() - 60000 });
  oauth.transporter.defaults.adapter = async config => {
    const url = new URL(config.url);
    calls.push({ url, config });
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const body = new URLSearchParams(config.data);
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), 'fixture-refresh-token');
      assert.equal(body.get('client_id'), 'fixture-client');
      assert.equal(body.get('client_secret'), 'fixture-client-secret');
      return { status: 200, statusText: 'OK', headers: {}, config,
        data: { access_token: 'fixture-access-token', expires_in: 3600, token_type: 'Bearer' } };
    }
    assert.equal(url.hostname, 'sheets.googleapis.com', 'Unexpected network target must never be sent');
    assert.equal(config.headers.Authorization, 'Bearer fixture-access-token');
    return { status: 200, statusText: 'OK', headers: {}, config, data: { valueRanges: [] } };
  };
  google.auth.GoogleAuth.prototype.getClient = async () => oauth;
  process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({ client_email: 'fixture@example.test', private_key: 'SYNTHETIC_NOT_A_REAL_KEY' });
  try {
    const { getSheets } = await import('../src/services/sheetsService.js?transport-fixture');
    const sheets = getSheets();
    const ranges = ["'Fixture & range'!B2:B", "'Fixture & range'!AP2:AP"];
    await sheets.spreadsheets.values.batchGet({ spreadsheetId: 'fixture-sheet', majorDimension: 'ROWS', ranges });
    const query = calls.find(call => call.url.hostname === 'sheets.googleapis.com').url;
    assert.deepEqual(query.searchParams.getAll('ranges'), ranges);
    assert.equal(query.searchParams.get('majorDimension'), 'ROWS');
    assert.equal(calls.filter(call => call.url.pathname === '/token').length, 1);
    await sheets.spreadsheets.values.get({ spreadsheetId: 'fixture-sheet', range: 'Fixture!A1:B2', valueRenderOption: 'UNFORMATTED_VALUE' });
    assert.equal(calls.filter(call => call.url.pathname === '/token').length, 1, 'refreshed access token must be reused');
    assert.equal(calls.length, 3);
  } finally {
    google.auth.GoogleAuth.prototype.getClient = originalGetClient;
    if (previousCredentials === undefined) delete process.env.GOOGLE_CREDENTIALS_JSON;
    else process.env.GOOGLE_CREDENTIALS_JSON = previousCredentials;
  }
});
