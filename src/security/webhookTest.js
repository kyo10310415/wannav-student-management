export function validateDiscordWebhook(value) {
  if (typeof value !== 'string') throw new Error('Invalid webhook');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port ||
      url.username || url.password || url.search || url.hash ||
      !/^\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{50,100}$/.test(url.pathname)) {
    throw new Error('Invalid webhook');
  }
  return url.href;
}

// Test delivery never loads real student, lesson or meeting data.
export function createWebhookTestHandler({ query, post }) {
  return async c => {
    if (c.get('authenticatedUser')?.role !== 'admin') return c.json({ success: false, error: '管理者権限が必要です' }, 403);
    let body;
    try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid request' }, 400); }
    let records;
    try {
      if (Number.isSafeInteger(body.userId) && body.userId > 0) {
        records = await query('SELECT discord_webhook_url FROM users WHERE id = $1', [body.userId]);
      } else if (typeof body.webhookUrl === 'string') {
        validateDiscordWebhook(body.webhookUrl);
        records = await query('SELECT discord_webhook_url FROM users WHERE discord_webhook_url = $1 LIMIT 1', [body.webhookUrl]);
      } else return c.json({ success: false, error: 'Registered userId is required' }, 400);
      if (!records.rows.length) return c.json({ success: false, error: 'Registered webhook not found' }, 400);
      const url = validateDiscordWebhook(records.rows[0].discord_webhook_url);
      await post(url, { content: 'WannaV システムの接続テストです。生徒・レッスン情報は含みません。',
        allowed_mentions: { parse: [] } }, { maxRedirects: 0, timeout: 5000,
        maxContentLength: 16 * 1024, maxBodyLength: 16 * 1024, proxy: false });
      return c.json({ success: true, message: 'Test notification sent successfully' });
    } catch {
      // HTTP errors may contain webhook credentials; do not log or return them.
      return c.json({ success: false, error: 'Webhook test failed' }, 400);
    }
  };
}
