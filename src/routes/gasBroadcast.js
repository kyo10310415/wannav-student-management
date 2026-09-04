import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { query } from '../db/connection.js';
import {
  enqueueBroadcast,
  GAS_BROADCAST_CREATED_BY,
  getBroadcastJobStatus,
  getBroadcastLogs
} from '../services/broadcastService.js';
import { client as discordClient } from '../services/discordService.js';

const DISCORD_MESSAGE_MAX_LENGTH = 2000;
const MAX_TARGETS = 500;
const MAX_CAMPAIGN_KEY_LENGTH = 250;
const DISCORD_HOST_PATTERN = /^(?:(?:canary|ptb|www)\.)?discord\.com$/i;
const DISCORD_CHANNEL_PATH_PATTERN = /^\/channels\/(\d{17,20})\/(\d{17,20})\/?$/;

function safeApiKeyEqual(actual, expected) {
  const actualDigest = createHash('sha256').update(actual).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function extractDiscordChannelId(chatUrl) {
  try {
    const parsed = new URL(chatUrl);
    if (
      parsed.protocol !== 'https:' ||
      !DISCORD_HOST_PATTERN.test(parsed.hostname) ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    return parsed.pathname.match(DISCORD_CHANNEL_PATH_PATTERN)?.[2] || null;
  } catch {
    return null;
  }
}

export function validateAndNormalizeSendRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object' };
  }

  if (typeof body.campaignKey !== 'string' || !body.campaignKey.trim()) {
    return { error: 'campaignKey is required' };
  }
  const campaignKey = body.campaignKey.trim();
  if (campaignKey.length > MAX_CAMPAIGN_KEY_LENGTH) {
    return { error: `campaignKey must be ${MAX_CAMPAIGN_KEY_LENGTH} characters or fewer` };
  }

  if (typeof body.content !== 'string' || !body.content.trim()) {
    return { error: 'content is required' };
  }
  if (body.content.length > DISCORD_MESSAGE_MAX_LENGTH) {
    return { error: `content must be ${DISCORD_MESSAGE_MAX_LENGTH} characters or fewer` };
  }

  if (!Array.isArray(body.targets) || body.targets.length === 0) {
    return { error: 'targets must contain at least one target' };
  }
  if (body.targets.length > MAX_TARGETS) {
    return { error: `targets must contain ${MAX_TARGETS} or fewer targets` };
  }

  const targetByStudentId = new Map();
  const studentIdByChannelId = new Map();

  for (let index = 0; index < body.targets.length; index++) {
    const target = body.targets[index];
    const label = `targets[${index}]`;

    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      return { error: `${label} must be an object` };
    }
    if (typeof target.studentId !== 'string' || !target.studentId.trim()) {
      return { error: `${label}.studentId is required` };
    }
    if (typeof target.studentName !== 'string' || !target.studentName.trim()) {
      return { error: `${label}.studentName is required` };
    }
    if (typeof target.chatUrl !== 'string' || !target.chatUrl.trim()) {
      return { error: `${label}.chatUrl is required` };
    }

    const studentId = target.studentId.trim();
    const studentName = target.studentName.trim();
    const chatUrl = target.chatUrl.trim();
    if (studentId.length > 50) {
      return { error: `${label}.studentId must be 50 characters or fewer` };
    }
    if (studentName.length > 255) {
      return { error: `${label}.studentName must be 255 characters or fewer` };
    }

    const channelId = extractDiscordChannelId(chatUrl);
    if (!channelId) {
      return { error: `${label}.chatUrl must be a Discord channel URL` };
    }

    const existingTarget = targetByStudentId.get(studentId);
    if (existingTarget) {
      if (existingTarget.channelId !== channelId) {
        return { error: `studentId ${studentId} is assigned to multiple Discord channels` };
      }
      continue;
    }

    const existingStudentId = studentIdByChannelId.get(channelId);
    if (existingStudentId && existingStudentId !== studentId) {
      return { error: `Discord channel ${channelId} is assigned to multiple students` };
    }

    targetByStudentId.set(studentId, {
      student_id: studentId,
      name: studentName,
      chat_url: chatUrl,
      channelId
    });
    studentIdByChannelId.set(channelId, studentId);
  }

  return {
    value: {
      campaignKey,
      content: body.content,
      targets: [...targetByStudentId.values()].map(({ channelId, ...target }) => target)
    }
  };
}

export function isDiscordBotReady(client) {
  try {
    return typeof client?.isReady === 'function'
      ? client.isReady()
      : Boolean(client?.readyAt);
  } catch {
    return false;
  }
}

export function createGasBroadcastRoutes(overrides = {}) {
  const dependencies = {
    query,
    enqueueBroadcast,
    getBroadcastJobStatus,
    getBroadcastLogs,
    discordClient,
    getApiKey: () => process.env.GAS_BROADCAST_API_KEY,
    ...overrides
  };
  const app = new Hono();

  app.use('*', async (c, next) => {
    const configuredKey = dependencies.getApiKey();
    if (!configuredKey) {
      return c.json({ success: false, error: 'GAS broadcast API is not configured' }, 503);
    }

    const suppliedKey = c.req.header('X-API-Key');
    if (!suppliedKey || !safeApiKeyEqual(suppliedKey, configuredKey)) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    return next();
  });

  app.get('/health', (c) => {
    if (!isDiscordBotReady(dependencies.discordClient)) {
      return c.json({
        success: false,
        botReady: false,
        error: 'Discord bot is not ready'
      }, 503);
    }

    return c.json({ success: true, botReady: true });
  });

  app.post('/send', async (c) => {
    if (!isDiscordBotReady(dependencies.discordClient)) {
      return c.json({
        success: false,
        botReady: false,
        error: 'Discord bot is not ready'
      }, 503);
    }

    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Request body must be valid JSON' }, 400);
    }

    const validation = validateAndNormalizeSendRequest(body);
    if (validation.error) {
      return c.json({ success: false, error: validation.error }, 400);
    }

    const { campaignKey, content, targets } = validation.value;

    try {
      const result = await dependencies.enqueueBroadcast(
        {
          campaignKey,
          content,
          channelType: 'chat',
          name: `GAS::${campaignKey}`,
          explicitTargets: true
        },
        targets,
        GAS_BROADCAST_CREATED_BY
      );

      return c.json({
        success: true,
        reused: result.reused === true,
        jobId: result.jobId,
        broadcastId: result.broadcastId,
        total: result.total
      });
    } catch (error) {
      console.error('[GAS Broadcast] Failed to enqueue broadcast:', error.message);
      return c.json({ success: false, error: 'Failed to enqueue broadcast' }, 500);
    }
  });

  app.get('/jobs/:jobId', async (c) => {
    const jobId = c.req.param('jobId');

    try {
      const ownership = await dependencies.query(
        `SELECT 1
         FROM broadcast_jobs bj
         INNER JOIN broadcast_messages bm ON bm.id = bj.broadcast_id
         WHERE bj.job_id = $1
           AND bj.created_by = $2
           AND bm.created_by = $2`,
        [jobId, GAS_BROADCAST_CREATED_BY]
      );
      if (ownership.rows.length === 0) {
        return c.json({ success: false, error: 'Job not found' }, 404);
      }

      const job = await dependencies.getBroadcastJobStatus(jobId);
      if (!job) {
        return c.json({ success: false, error: 'Job not found' }, 404);
      }

      return c.json({
        success: true,
        job: {
          jobId: job.job_id,
          broadcastId: job.broadcast_id,
          status: job.status,
          total: job.total,
          sent: job.sent,
          failed: job.failed
        }
      });
    } catch (error) {
      console.error('[GAS Broadcast] Failed to get job status:', error.message);
      return c.json({ success: false, error: 'Failed to get job status' }, 500);
    }
  });

  app.get('/results/:broadcastId', async (c) => {
    const broadcastIdParam = c.req.param('broadcastId');
    if (!/^\d+$/.test(broadcastIdParam)) {
      return c.json({ success: false, error: 'Invalid broadcastId' }, 400);
    }
    const broadcastId = Number(broadcastIdParam);
    if (!Number.isSafeInteger(broadcastId) || broadcastId < 1) {
      return c.json({ success: false, error: 'Invalid broadcastId' }, 400);
    }

    try {
      const ownership = await dependencies.query(
        `SELECT 1
         FROM broadcast_messages
         WHERE id = $1 AND created_by = $2`,
        [broadcastId, GAS_BROADCAST_CREATED_BY]
      );
      if (ownership.rows.length === 0) {
        return c.json({ success: false, error: 'Broadcast not found' }, 404);
      }

      const logs = await dependencies.getBroadcastLogs(broadcastId, 1000);
      return c.json({
        success: true,
        results: logs.map(log => ({
          studentId: log.student_id,
          studentName: log.student_name,
          status: log.status,
          errorMessage: log.error_message,
          sentAt: log.sent_at
        }))
      });
    } catch (error) {
      console.error('[GAS Broadcast] Failed to get broadcast results:', error.message);
      return c.json({ success: false, error: 'Failed to get broadcast results' }, 500);
    }
  });

  return app;
}

export default createGasBroadcastRoutes();
