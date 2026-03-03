import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Routes
import studentRoutes from './routes/students.js';
import tutorRoutes from './routes/tutors.js';
import lessonRoutes from './routes/lessons.js';
import reminderRoutes from './routes/reminders.js';
import externalRoutes from './routes/external.js';
import helperRequestRoutes from './routes/helper-requests.js';
import scheduleRoutes from './routes/schedules.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';

// Services
import { sendDailyReminders } from './services/reminderService.js';
import { sendDailyStatsReport } from './services/statsReportService.js';

const app = new Hono();

// Middleware
app.use('*', cors());

// Serve static files from public directory
// Use absolute path to avoid path issues
const publicPath = path.join(__dirname, '..', 'public');
console.log('Serving static files from:', publicPath);
app.use('/*', serveStatic({ root: publicPath }));

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.route('/api/students', studentRoutes);
app.route('/api/tutors', tutorRoutes);
app.route('/api/lessons', lessonRoutes);
app.route('/api/reminders', reminderRoutes);
app.route('/api/external', externalRoutes);
app.route('/api/helper-requests', helperRequestRoutes);
app.route('/api/schedules', scheduleRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/users', userRoutes);

// Serve index.html for root
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WannaV 中央管理システム</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
        <div id="app"></div>
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
        <script src="/app.js"></script>
    </body>
    </html>
  `);
});

// Schedule daily reminders (runs at 17:00 JST every day)
// JST = UTC+9, so 17:00 JST = 08:00 UTC
// Can be disabled by setting DISCORD_REMINDERS_ENABLED=false
if (process.env.DISCORD_REMINDERS_ENABLED !== 'false') {
  console.log('Discord automatic reminders: ENABLED (17:00 JST daily)');
  cron.schedule('0 8 * * *', async () => {
    console.log('Running daily reminder task at 17:00 JST...');
    try {
      await sendDailyReminders();
      console.log('Daily reminders sent successfully');
    } catch (error) {
      console.error('Error sending daily reminders:', error);
    }
  }, {
    timezone: 'Asia/Tokyo'
  });
} else {
  console.log('Discord automatic reminders: DISABLED (DISCORD_REMINDERS_ENABLED=false)');
}

// Schedule helper request expiration check (runs every hour)
console.log('Helper request expiration check: ENABLED (runs every hour)');
cron.schedule('0 * * * *', async () => {
  console.log('Running helper request expiration check...');
  try {
    const response = await fetch(`http://localhost:${port}/api/helper-requests/check-expired`, {
      method: 'POST'
    });
    const result = await response.json();
    console.log('Helper request expiration check completed:', result.message);
  } catch (error) {
    console.error('Error checking expired helper requests:', error);
  }
}, {
  timezone: 'Asia/Tokyo'
});

// Schedule daily statistics report (runs at 13:00 JST every day)
// JST = UTC+9, so 13:00 JST = 04:00 UTC
if (process.env.DISCORD_STATS_REPORT_ENABLED !== 'false') {
  console.log('Discord daily statistics report: ENABLED (13:00 JST daily)');
  cron.schedule('0 4 * * *', async () => {
    console.log('Running daily statistics report at 13:00 JST...');
    try {
      await sendDailyStatsReport();
      console.log('Daily statistics report sent successfully');
    } catch (error) {
      console.error('Error sending daily statistics report:', error);
    }
  }, {
    timezone: 'Asia/Tokyo'
  });
} else {
  console.log('Discord daily statistics report: DISABLED (DISCORD_STATS_REPORT_ENABLED=false)');
}

const port = process.env.PORT || 3000;

console.log(`Server is running on port ${port}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

serve({
  fetch: app.fetch,
  port: Number(port),
});
