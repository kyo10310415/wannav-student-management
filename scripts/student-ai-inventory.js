import 'dotenv/config';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkpointReader } from '../src/services/inventoryCheckpoint.js';
import { createReadonlyDriveClients, getTranscriptFromDoc } from '../src/services/driveService.js';
import { collectDriveInventory, collectDatabaseInventory, reconcileInventory, resolveDriveStudents } from '../src/services/studentAiInventoryService.js';

// Standalone read-only entrypoint. Never imports index.js, migrations, or minutesService.
const arg = process.argv.slice(2);
if (arg.some(a => !/^--text-limit=(all|\d+)$/.test(a) && !/^--checkpoint-dir=.+$/.test(a)) ||
    new Set(arg.map(a => a.split('=')[0])).size !== arg.length) {
  console.error('Usage: node scripts/student-ai-inventory.js [--text-limit=50|all] [--checkpoint-dir=/absolute/path]');
  process.exit(2);
}
const value = arg.find(a => a.startsWith('--text-limit='))?.slice(13) || '50';
const textLimit = value === 'all' ? Infinity : Number(value);
if (!(textLimit === Infinity || Number.isSafeInteger(textLimit))) process.exit(2);
const checkpointDirectory = arg.find(a => a.startsWith('--checkpoint-dir='))?.slice(17);
const progress = info => console.error(JSON.stringify({ at: new Date().toISOString(), ...info }));
let lastProgress = {};
const onProgress = info => {
  lastProgress = info;
  if (info.completed === 0 || info.completed === info.total || info.completed % 25 === 0) progress(info);
};
const heartbeat = setInterval(() => progress({ ...lastProgress, heartbeat: true }), 30000);
heartbeat.unref();
let checkpointHits = 0;
const report = { startedAt: new Date().toISOString(), readOnly: true, openaiCalls: 0, errors: [] };
let drive, db;
if (!process.env.GOOGLE_CREDENTIALS_JSON) report.errors.push('GOOGLE_CREDENTIALS_JSON_UNSET');
else {
  try {
    const clients = createReadonlyDriveClients();
    const parentFolderId = process.env.LESSON_DRIVE_FOLDER_ID || '18YfaP1CrW5Lq_sAeVAR56tIRZR3GwMDS';
    // Bound actual HTTP requests, including the fallback request, without changing production service defaults.
    const boundedDocs = { documents: { get: args => clients.docs.documents.get(args, { timeout: 60000, retry: false }) } };
    const boundedDrive = { files: { list: args => clients.drive.files.list(args, { timeout: 60000, retry: false }) } };
    const readTranscript = async id => {
      let fallback = false;
      let extraction;
      const text = await getTranscriptFromDoc(boundedDocs, id, { log() {}, warn() { fallback = true; } }, value => { extraction = value; });
      return { text, fallback, extraction };
    };
    const versionHash = createHash('sha256');
    for (const path of ['../src/services/driveService.js', '../src/services/studentAiInventoryService.js', '../src/services/inventoryCheckpoint.js']) {
      versionHash.update(readFileSync(new URL(path, import.meta.url)));
    }
    const namespace = parentFolderId + ':' + versionHash.digest('hex');
    drive = await collectDriveInventory({ drive: boundedDrive, parentFolderId, textLimit, onProgress,
      readTranscript: checkpointDirectory ? checkpointReader({ directory: checkpointDirectory, namespace, readTranscript,
        onHit: () => { checkpointHits++; } }) : readTranscript });
  } catch { report.errors.push('DRIVE_INVENTORY_FAILED'); }
}
if (!process.env.DATABASE_URL) report.errors.push('DATABASE_URL_UNSET');
else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
  let client;
  try { lastProgress = { phase: 'database' }; progress(lastProgress); client = await pool.connect(); db = await collectDatabaseInventory(client); }
  catch { report.errors.push('DB_INVENTORY_FAILED'); }
  finally { client?.release(); await pool.end(); }
}
lastProgress = { phase: 'reconciliation' };
progress(lastProgress);
if (drive && db) drive = resolveDriveStudents(drive, db.students);
report.reconciliation = reconcileInventory(drive, db);
// No document bodies, prompts, credentials or raw DB rows in output.
if (drive) { const { folders, documents, ...summary } = drive; report.drive = summary; }
if (db) { const { students, minutes, ...summary } = db; report.database = summary; }
report.checkpoint = { enabled: Boolean(checkpointDirectory), reusedDocuments: checkpointHits };
clearInterval(heartbeat);
report.finishedAt = new Date().toISOString();
report.status = report.errors.length || drive?.complete === false ? 'incomplete' : 'complete';
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'complete') process.exitCode = 1;
