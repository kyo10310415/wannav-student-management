import axios from 'axios';
import { query } from '../db/connection.js';

const WEEK = 7 * 86400000;
export function createXActivityReader({ db = query, get = (...args) => axios.get(...args), token = () => process.env.X_BEARER_TOKEN } = {}) {
  return async function readXActivity(account, periods, now) {
    const username = String(account || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(username) || !token()) return null;
    const cached = (await db('SELECT * FROM action_point_x_cache WHERE username=$1', [username])).rows[0];
    const result = row => row?.last_checked_at && typeof row.last_inactive === 'boolean'
      ? { inactive: row.last_inactive, checkedAt: row.last_checked_at, lastPostAt: row.last_post_at } : null;
    // A previously observed recent post already proves the 14-day criterion.
    // Do not move last_checked_at: this is a local reuse, not another API read.
    if (cached?.last_post_at && new Date(cached.last_post_at) >= periods.fourteen && new Date(cached.last_post_at) <= now) {
      return { inactive: false, checkedAt: cached.last_checked_at, lastPostAt: cached.last_post_at };
    }
    if (cached?.last_checked_at && now - new Date(cached.last_checked_at) < WEEK) return result(cached);
    // Persist attempts as well as successes to prevent daily paid retries after
    // failure. This atomic claim also deduplicates multiple students/instances.
    const claimed = (await db(`INSERT INTO action_point_x_cache (username,last_attempt_at) VALUES ($1,$2)
      ON CONFLICT (username) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at
      WHERE action_point_x_cache.last_attempt_at IS NULL OR action_point_x_cache.last_attempt_at <= $2::timestamptz - INTERVAL '7 days'
      RETURNING *`, [username, now])).rows[0];
    if (!claimed) return null;
    const config = { headers: { Authorization: `Bearer ${token()}` }, timeout: 15000 };
    let userId = claimed.x_user_id;
    if (!userId) {
      const user = await get(`https://api.x.com/2/users/by/username/${username}`, config);
      userId = user.data?.data?.id;
      if (!/^\d+$/.test(userId || '')) throw new Error('X identity unavailable');
      // Save the ID even if the following timeline request fails.
      await db('UPDATE action_point_x_cache SET x_user_id=$2 WHERE username=$1', [username, userId]);
    }
    const response = await get(`https://api.x.com/2/users/${userId}/tweets`, { ...config,
      params: { start_time: periods.fourteen.toISOString(), end_time: now.toISOString(), max_results: 5, 'tweet.fields': 'created_at' } });
    if (response.data?.errors || !response.data || (!Array.isArray(response.data.data) && !(response.data.data === undefined && response.data.meta?.result_count === 0))) throw new Error('X activity unavailable');
    const posts = response.data.data || [];
    if (posts.some(post => !Number.isFinite(new Date(post.created_at).getTime()) || new Date(post.created_at) < periods.fourteen || new Date(post.created_at) > now)) throw new Error('Invalid X post time');
    const latest = posts.length ? new Date(Math.max(...posts.map(post => new Date(post.created_at).getTime()))) : claimed.last_post_at;
    const inactive = posts.length === 0;
    await db(`UPDATE action_point_x_cache SET last_checked_at=$2, last_post_at=$3, last_inactive=$4 WHERE username=$1`, [username, now, latest || null, inactive]);
    return { inactive, checkedAt: now, lastPostAt: latest || null };
  };
}

export const readXActivity = createXActivityReader();
