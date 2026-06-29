import { Hono } from 'hono';
import { query } from '../db/connection.js';
import axios from 'axios';

const app = new Hono();

const DISCORD_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1521000822224191600/YWwftFzi_KgzCt1ptqWCAf5zS3kHA4pf7jrF8Bg7rCKEmULnuC4ogB734pAJMx9DyEqD';
const ROLE_ID = '1294923221107478571';

// ─────────────────────────────────────────────
// GET /api/withdrawal-requests/student/:studentId
// 学籍番号で生徒情報を取得（モーダル自動入力用）
// ─────────────────────────────────────────────
app.get('/student/:studentId', async (c) => {
  try {
    const { studentId } = c.req.param();
    const result = await query(
      `SELECT s.student_id, s.name, s.homeroom_tutor, s.notion_url,
              u.discord_user_id
       FROM students s
       LEFT JOIN tutors t ON s.homeroom_tutor = t.tutor_name
       LEFT JOIN users  u ON LOWER(t.email) = LOWER(u.email)
       WHERE s.student_id = $1
       LIMIT 1`,
      [studentId]
    );
    if (result.rows.length === 0) {
      return c.json({ success: false, error: '生徒が見つかりません' }, 404);
    }
    return c.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[WithdrawalRequests] GET /student error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────
// GET /api/withdrawal-requests
// 退会申請一覧を取得（新しい順）
// ─────────────────────────────────────────────
app.get('/', async (c) => {
  try {
    const result = await query(`
      SELECT id, student_id, student_name, homeroom_tutor,
             withdrawal_date, category, reason, notion_url,
             submitted_by, created_at
      FROM withdrawal_requests
      ORDER BY created_at DESC
    `);
    return c.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[WithdrawalRequests] GET / error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────
// POST /api/withdrawal-requests
// 退会申請を登録してDiscord通知
// Body: { student_id, student_name, homeroom_tutor, withdrawal_date, category, reason, notion_url, discord_user_id }
// ─────────────────────────────────────────────
app.post('/', async (c) => {
  try {
    const {
      student_id,
      student_name,
      homeroom_tutor,
      withdrawal_date,
      category,
      reason,
      notion_url,
      discord_user_id,
      submitted_by,
    } = await c.req.json();

    // バリデーション
    if (!student_id || !student_name || !withdrawal_date || !category) {
      return c.json({ success: false, error: '必須項目が不足しています' }, 400);
    }

    // DB登録
    const insertResult = await query(
      `INSERT INTO withdrawal_requests
         (student_id, student_name, homeroom_tutor, withdrawal_date, category, reason, notion_url, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [student_id, student_name, homeroom_tutor || null, withdrawal_date, category, reason || null, notion_url || null, submitted_by || null]
    );
    const record = insertResult.rows[0];

    // Discord通知
    await sendWithdrawalNotification(record, discord_user_id);

    return c.json({ success: true, data: record });
  } catch (error) {
    console.error('[WithdrawalRequests] POST / error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ─────────────────────────────────────────────
// Discord通知送信
// ─────────────────────────────────────────────
async function sendWithdrawalNotification(record, discordUserId) {
  try {
    const [y, m, d] = record.withdrawal_date.toISOString
      ? record.withdrawal_date.toISOString().slice(0, 10).split('-')
      : String(record.withdrawal_date).slice(0, 10).split('-');
    const dateStr = `${y}/${parseInt(m)}/${parseInt(d)}`;

    // カテゴリ別の色
    const color = record.category === '強制退会' ? 0xEF4444 : 0xF59E0B;

    // メンション: 担任Tutor（個人） + ロール
    const mentionParts = [];
    if (discordUserId) mentionParts.push(`<@${discordUserId}>`);
    mentionParts.push(`<@&${ROLE_ID}>`);
    const mention = mentionParts.join(' ');

    const embed = {
      title: `【${record.category}申請】${record.student_name} さん`,
      color,
      fields: [
        { name: '📋 学籍番号',   value: record.student_id,                inline: true },
        { name: '👤 生徒名',     value: record.student_name,              inline: true },
        { name: '👨‍🏫 担任Tutor', value: record.homeroom_tutor || '不明',  inline: true },
        { name: '📅 退会日',     value: dateStr,                          inline: true },
        { name: '🏷️ 区分',      value: record.category,                  inline: true },
        { name: '📝 理由',       value: record.reason || '（記入なし）',  inline: false },
        ...(record.notion_url
          ? [{ name: '🔗 Notion', value: record.notion_url, inline: false }]
          : []),
      ],
      footer: { text: '生徒管理システム - 退会申請' },
      timestamp: new Date().toISOString(),
    };

    await axios.post(DISCORD_WEBHOOK_URL, {
      content: mention,
      embeds: [embed],
    });

    console.log(`[WithdrawalRequests] Discord notified for student: ${record.student_id}`);
  } catch (error) {
    console.error('[WithdrawalRequests] Discord notification failed:', error.message);
    // 通知失敗でも申請登録は成功扱い
  }
}

export default app;
