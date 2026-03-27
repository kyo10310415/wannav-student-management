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
import extensionRoutes from './routes/extensions.js';
import suspensionRoutes from './routes/suspensions.js';
import statsRoutes from './routes/stats.js';
import databaseRoutes from './routes/database.js';
import broadcastRoutes from './routes/broadcast.js';
import surveyRoutes from './routes/survey.js';
import rouletteRoutes from './routes/roulette.js';
import settingsRoutes from './routes/settings.js';
import lessonCompletionRoutes from './routes/lessonCompletion.js';
import lessonReportReminderRoutes from './routes/lessonReportReminder.js';
import vqDiagnosisRoutes from './routes/vq-diagnosis.js';

// Services
import { sendDailyReminders } from './services/reminderService.js';
import { sendDailyStatsReport } from './services/statsReportService.js';
import { checkAndExecuteSchedules } from './services/schedulerService.js';
import { checkStampRallyAchievements } from './services/stampRallyService.js';

// Jobs
import sendLessonReportReminder from './jobs/lessonReportReminder.js';
import { sendSurveyReminderNotifications } from './jobs/surveyReminderNotification.js';

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
app.route('/api/extensions', extensionRoutes);
app.route('/api/suspensions', suspensionRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api/database', databaseRoutes);
app.route('/api/broadcast', broadcastRoutes);
app.route('/api/survey', surveyRoutes);
app.route('/api/roulette', rouletteRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/lesson-completion', lessonCompletionRoutes);
app.route('/api/lesson-report-reminder', lessonReportReminderRoutes);
app.route('/api/vq-diagnosis', vqDiagnosisRoutes);

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
        <script src="/app.js?v=${Date.now()}"></script>
    </body>
    </html>
  `);
});

// Schedule daily reminders (runs at 17:00 JST every day)
// With timezone: 'Asia/Tokyo', cron expression is interpreted in JST
// Can be disabled by setting DISCORD_REMINDERS_ENABLED=false
if (process.env.DISCORD_REMINDERS_ENABLED !== 'false') {
  console.log('Discord automatic reminders: ENABLED (17:00 JST daily)');
  cron.schedule('0 17 * * *', async () => {
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
// With timezone: 'Asia/Tokyo', cron expression is interpreted in JST
if (process.env.DISCORD_STATS_REPORT_ENABLED !== 'false') {
  console.log('Discord daily statistics report: ENABLED (13:00 JST daily)');
  cron.schedule('0 13 * * *', async () => {
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

// Schedule broadcast scheduler check (runs every 30 minutes)
console.log('Broadcast scheduler: ENABLED (checks every 30 minutes)');
cron.schedule('0,30 * * * *', async () => {
  try {
    await checkAndExecuteSchedules();
  } catch (error) {
    console.error('Error checking broadcast schedules:', error);
  }
}, {
  timezone: 'Asia/Tokyo'
});

// Schedule stamp rally achievement check (daily at 10:00 JST)
console.log('Stamp rally checker: ENABLED (daily at 10:00 JST)');
cron.schedule('0 10 * * *', async () => {
  console.log('Running stamp rally achievement check at 10:00 JST...');
  try {
    await checkStampRallyAchievements();
  } catch (error) {
    console.error('Error in stamp rally achievement check:', error);
  }
}, {
  timezone: 'Asia/Tokyo'
});

// Schedule lesson report reminder (daily at 17:00 JST)
// Checks yesterday's lessons and sends reminders for unreported lessons
if (process.env.LESSON_REPORT_REMINDER_ENABLED !== 'false') {
  console.log('Lesson report reminder: ENABLED (17:00 JST daily)');
  cron.schedule('0 17 * * *', async () => {
    console.log('Running lesson report reminder at 17:00 JST...');
    try {
      await sendLessonReportReminder();
      console.log('Lesson report reminders sent successfully');
    } catch (error) {
      console.error('Error sending lesson report reminders:', error);
    }
  }, {
    timezone: 'Asia/Tokyo'
  });
} else {
  console.log('Lesson report reminder: DISABLED (LESSON_REPORT_REMINDER_ENABLED=false)');
}

// Schedule survey reminder notifications (runs every hour)
// Checks for lessons 12 hours ago and sends reminders to students who haven't responded to survey
console.log('Survey reminder notifications: ENABLED (checks every hour)');
cron.schedule('0 * * * *', async () => {
  console.log('Running survey reminder check...');
  try {
    await sendSurveyReminderNotifications();
    console.log('Survey reminder check completed');
  } catch (error) {
    console.error('Error in survey reminder notifications:', error);
  }
}, {
  timezone: 'Asia/Tokyo'
});

// Schedule VQ diagnosis checker (runs every 5 minutes)
// Checks Google Sheets for new VQ diagnosis results and sends Discord notifications
console.log('VQ diagnosis checker: ENABLED (checks every 5 minutes)');
cron.schedule('*/5 * * * *', async () => {
  console.log('Running VQ diagnosis check...');
  try {
    const checkAndSendVQDiagnosis = (await import('./jobs/vqDiagnosisChecker.js')).default;
    await checkAndSendVQDiagnosis();
    console.log('VQ diagnosis check completed');
  } catch (error) {
    console.error('Error in VQ diagnosis check:', error);
  }
}, {
  timezone: 'Asia/Tokyo'
});

const port = process.env.PORT || 3000;

console.log(`Server is running on port ${port}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

serve({
  fetch: app.fetch,
  port: Number(port),
});
