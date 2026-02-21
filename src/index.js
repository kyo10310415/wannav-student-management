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

// Services
import { sendDailyReminders } from './services/reminderService.js';

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

// Serve index.html for root
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WannaV 生徒様管理システム</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
        <div id="app"></div>
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/app.js"></script>
    </body>
    </html>
  `);
});

// Schedule daily reminders (runs at 10:00 AM JST every day)
// JST = UTC+9, so 10:00 JST = 01:00 UTC
// Can be disabled by setting DISCORD_REMINDERS_ENABLED=false
if (process.env.DISCORD_REMINDERS_ENABLED !== 'false') {
  console.log('Discord automatic reminders: ENABLED');
  cron.schedule('0 1 * * *', async () => {
    console.log('Running daily reminder task...');
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

const port = process.env.PORT || 3000;

console.log(`Server is running on port ${port}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

serve({
  fetch: app.fetch,
  port: Number(port),
});
