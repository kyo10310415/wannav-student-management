import 'dotenv/config';
import pg from 'pg';
import { createReadonlyDriveClients, getTranscriptFromDoc } from '../src/services/driveService.js';
import { collectDriveInventory, collectDatabaseInventory, reconcileInventory, resolveDriveStudents } from '../src/services/studentAiInventoryService.js';

// Standalone read-only entrypoint. Never imports index.js, migrations, or minutesService.
const arg = process.argv.slice(2);
if (arg.some(a => !/^--text-limit=(all|\d+)$/.test(a)) || arg.length > 1) {
  console.error('Usage: node scripts/student-ai-inventory.js [--text-limit=50|all]');
  process.exit(2);
}
const value = arg[0]?.split('=')[1] || '50';
const textLimit = value === 'all' ? Infinity : Number(value);
const report = { startedAt: new Date().toISOString(), readOnly: true, openaiCalls: 0, errors: [] };
let drive, db;
if (!process.env.GOOGLE_CREDENTIALS_JSON) report.errors.push('GOOGLE_CREDENTIALS_JSON_UNSET');
else {
  try {
    const clients = createReadonlyDriveClients();
    drive = await collectDriveInventory({ drive: clients.drive,
      parentFolderId: process.env.LESSON_DRIVE_FOLDER_ID || '18YfaP1CrW5Lq_sAeVAR56tIRZR3GwMDS', textLimit,
      readTranscript: async id => {
        let fallback = false;
        const text = await getTranscriptFromDoc(clients.docs, id, { log() {}, warn() { fallback = true; } });
        return { text, fallback };
      } });
  } catch { report.errors.push('DRIVE_INVENTORY_FAILED'); }
}
if (!process.env.DATABASE_URL) report.errors.push('DATABASE_URL_UNSET');
else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
  let client;
  try { client = await pool.connect(); db = await collectDatabaseInventory(client); }
  catch { report.errors.push('DB_INVENTORY_FAILED'); }
  finally { client?.release(); await pool.end(); }
}
if (drive && db) drive = resolveDriveStudents(drive, db.students);
report.reconciliation = reconcileInventory(drive, db);
// No document bodies, prompts, credentials or raw DB rows in output.
if (drive) { const { folders, documents, ...summary } = drive; report.drive = summary; }
if (db) { const { students, minutes, ...summary } = db; report.database = summary; }
report.finishedAt = new Date().toISOString();
report.status = report.errors.length || drive?.complete === false ? 'incomplete' : 'complete';
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'complete') process.exitCode = 1;
