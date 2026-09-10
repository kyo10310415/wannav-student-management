// Metadata/length-only inventory. No OpenAI, DML, application startup, or cron imports.
const ID = /^OL[A-Z]{2}\d{6}-[A-Z0-9]{2}$/;
export function recognizedStudentId(name, students = []) { return students.includes(name) ? name : null; }

export function resolveFolder(folder, students) {
  const base = { folderId: folder.id, folderName: folder.name, resolvedStudentId: null,
    formatAnomaly: !ID.test(folder.name || ''), candidates: [] };
  if (students == null) return { ...base, status: 'unresolved_db_unavailable' };
  if (students.includes(folder.name)) return { ...base, resolvedStudentId: folder.name, status: 'matched' };
  const normalize = s => s.trim().toUpperCase().replace(/^0/, 'O').replace(/[-‐‑‒–—−ー－]/g, '');
  const candidates = students.filter(id => normalize(id) === normalize(folder.name) || similarIds(folder.name, id));
  return { ...base, candidates, status: candidates.length ? 'possible_typo' : 'unmatched' };
}

export function resolveDriveStudents(inventory, students) {
  const folderCounts = new Map();
  for (const d of inventory.documents) for (const f of d.folders) folderCounts.set(f.folderId, (folderCounts.get(f.folderId) || 0) + 1);
  const folderResolutions = inventory.folders.map(f => ({ ...resolveFolder(f, students),
    documentCount: folderCounts.get(f.id) || 0,
    listingComplete: !(inventory.failures || []).some(e => e.folderId === f.id) }));
  const byId = new Map(folderResolutions.map(f => [f.folderId, f]));
  const documents = inventory.documents.map(d => {
    const folders = d.folders.map(f => byId.get(f.folderId) || resolveFolder({ id: f.folderId, name: f.folderName }, students));
    const ids = new Set(folders.map(f => f.resolvedStudentId));
    const resolvedStudentId = ids.size === 1 && !ids.has(null) ? [...ids][0] : null;
    return { ...d, folders, resolvedStudentId, studentId: resolvedStudentId };
  });
  const perStudent = Object.create(null);
  for (const f of folderResolutions) if (f.resolvedStudentId !== null) perStudent[f.resolvedStudentId] = 0;
  for (const d of documents) if (d.resolvedStudentId !== null) perStudent[d.resolvedStudentId]++;
  return { ...inventory, documents, folderResolutions, resolutionComplete: students != null,
    studentFolderCount: students == null ? null : folderResolutions.filter(f => f.status === 'matched').length,
    unmatchedFolderCount: students == null ? null : folderResolutions.filter(f => f.status !== 'matched').length,
    unmatchedFolders: folderResolutions.filter(f => f.status !== 'matched'),
    typoSuspects: folderResolutions.filter(f => f.status === 'possible_typo'),
    formatAnomalies: folderResolutions.filter(f => f.formatAnomaly),
    duplicateStudentFolders: groups(folderResolutions.map(f => ({ ...f, id: f.folderId })), f => f.resolvedStudentId),
    perStudent, lessonsPerStudent: statistics(Object.values(perStudent)),
    studentCharacterInventory: summarizeStudentCharacters(documents, Object.keys(perStudent), inventory.complete, students != null),
    sameDayMultipleDocs: groups(documents, d => d.studentId && d.date ? `${d.studentId}/${d.date}` : null),
    multiFolderDocs: documents.filter(d => d.folders.length > 1) };
}

export function statistics(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return { count: n, total: sorted.reduce((a, b) => a + b, 0),
    mean: n ? sorted.reduce((a, b) => a + b, 0) / n : null,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    p95: n ? sorted[Math.ceil(n * .95) - 1] : null, max: n ? sorted[n - 1] : null };
}

export function fileDate(name) {
  const m = (name || '').match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const parsed = new Date(date + 'T00:00:00Z');
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function groups(rows, key) {
  const map = new Map();
  for (const row of rows) { const k = key(row); if (k != null) map.set(k, [...(map.get(k) || []), row]); }
  return [...map].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ key, count: rows.length, ids: rows.map(r => r.id) }));
}

export function similarIds(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export async function listAllFiles(drive, parent, mimeType) {
  const files = new Map();
  const seen = new Set();
  let pageToken;
  do {
    const response = await drive.files.list({
      q: `'${parent.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents and mimeType = '${mimeType}' and trashed = false`,
      pageSize: 200, pageToken, fields: 'nextPageToken,incompleteSearch,files(id,name,createdTime,modifiedTime)',
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    if (response.data.incompleteSearch) throw new Error('INCOMPLETE_DRIVE_SEARCH');
    for (const f of response.data.files || []) files.set(f.id, f);
    pageToken = response.data.nextPageToken;
    if (pageToken && seen.has(pageToken)) throw new Error('REPEATED_PAGE_TOKEN');
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return [...files.values()];
}

export async function collectDriveInventory({ drive, readTranscript, parentFolderId, textLimit = 50, students = null, onProgress = () => {} }) {
  if (!(textLimit === Infinity || Number.isInteger(textLimit) && textLimit >= 0)) throw new Error('INVALID_TEXT_LIMIT');
  const folders = await listAllFiles(drive, parentFolderId, 'application/vnd.google-apps.folder');
  folders.sort((a, b) => a.id.localeCompare(b.id));
  const documents = new Map();
  const failures = [];
  let folderIndex = 0;
  onProgress({ phase: 'listing', total: folders.length, completed: 0 });
  for (const folder of folders) {
    try {
      const files = await listAllFiles(drive, folder.id, 'application/vnd.google-apps.document');
      for (const file of files) {
        const existing = documents.get(file.id);
        if (existing) {
          existing.folderIds.push(folder.id);
          existing.folders.push({ folderId: folder.id, folderName: folder.name, resolvedStudentId: null });
          continue;
        }
        documents.set(file.id, { id: file.id, studentId: null, folderIds: [folder.id],
          folders: [{ folderId: folder.id, folderName: folder.name, resolvedStudentId: null }],
          modifiedTime: file.modifiedTime || null,
          date: fileDate(file.name), createdDate: file.createdTime?.slice(0, 10) || null });
      }
    } catch { failures.push({ folderId: folder.id, code: 'FOLDER_READ_FAILED' }); }
    onProgress({ phase: 'listing', completed: ++folderIndex, total: folders.length });
  }
  // Spread a deterministic sample across the complete list; never claim it is a population metric.
  const docs = [...documents.values()].sort((a, b) => a.id.localeCompare(b.id));
  const count = Math.min(textLimit, docs.length);
  const lengths = [];
  const extractionSamples = [];
  const lengthsByMode = new Map();
  let fallbackCount = 0;
  onProgress({ phase: 'text', completed: 0, total: count });
  for (let i = 0; i < count; i++) {
    const doc = docs[Math.floor(i * docs.length / count)];
    try {
      const result = await readTranscript(doc.id, doc);
      const characters = result.characters ?? Array.from(result.text).length;
      if (!Number.isSafeInteger(characters) || characters < 0) throw new Error('INVALID_CHARACTERS');
      lengths.push(characters);
      const mode = result.extraction?.mode || 'unspecified';
      lengthsByMode.set(mode, [...(lengthsByMode.get(mode) || []), characters]);
      doc.measurement = { characters, mode };
      // Only allowlisted metadata, never raw text. Bound diagnostic records even on --all.
      if (extractionSamples.length < 50) extractionSamples.push({ documentId: doc.id,
        folders: doc.folders.map(f => ({ folderId: f.folderId, folderName: f.folderName })),
        mode, selectedTab: result.extraction?.selectedTab ?? null,
        tabTitles: result.extraction?.tabTitles || [], apiFallback: result.extraction?.apiFallback || false,
        characters });
      if (result.fallback) fallbackCount++;
    } catch { failures.push({ documentId: doc.id, code: 'TEXT_READ_FAILED' }); }
    onProgress({ phase: 'text', completed: i + 1, total: count, failures: failures.length });
  }
  const dates = docs.map(d => d.date).filter(Boolean).sort();
  return resolveDriveStudents({ complete: !failures.length, folders, documents: docs,
    folderCount: folders.length, totalDocs: docs.length,
    oldestFileDate: dates[0] || null, newestFileDate: dates.at(-1) || null,
    dateMissingCount: docs.filter(d => !d.date).length,
    extractionSamples,
    charactersByExtractionMode: Object.fromEntries([...lengthsByMode].map(([mode, values]) => [mode, statistics(values)])),
    characters: { ...statistics(lengths), attempted: count, population: docs.length,
      fullPopulation: lengths.length === docs.length && !failures.length,
      sampling: 'deterministic evenly spaced by file ID; not random', fallbackCount }, failures }, students);
}

export async function collectDatabaseInventory(client) {
  // This transaction also prevents accidental future DML, regardless of account permissions.
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    const students = (await client.query('SELECT student_id FROM students ORDER BY student_id')).rows.map(r => r.student_id);
    const minutes = [];
    let afterId = 0;
    for (;;) {
      const result = await client.query(
        `SELECT id, student_id, lesson_date::text AS lesson_date, drive_file_id, lesson_number,
                CHAR_LENGTH(COALESCE(generated_text, '')) AS generated_chars,
                CHAR_LENGTH(COALESCE(transcript, '')) AS transcript_chars
           FROM minutes WHERE id > $1 ORDER BY id LIMIT 1000`, [afterId]);
      minutes.push(...result.rows);
      if (result.rows.length < 1000) break;
      const next = Number(result.rows.at(-1).id);
      if (next <= afterId) throw new Error('INVALID_DB_CURSOR');
      afterId = next;
    }
    await client.query('ROLLBACK');
    return summarizeDatabase(minutes, students);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export function summarizeDatabase(minutes, students) {
  const known = new Set(students);
  const perStudent = Object.fromEntries(students.map(id => [id, 0]));
  const perStudentCharacters = Object.create(null);
  const hasId = row => Boolean(row.drive_file_id?.trim());
  for (const row of minutes) {
    perStudent[row.student_id] = (perStudent[row.student_id] || 0) + 1;
    const chars = perStudentCharacters[row.student_id] ||= { generated: 0, transcript: 0 };
    chars.generated += Number(row.generated_chars); chars.transcript += Number(row.transcript_chars);
  }
  return { totalMinutes: minutes.length, perStudent, lessonsPerStudent: statistics(Object.values(perStudent)),
    withDriveId: minutes.filter(hasId).length, withoutDriveId: minutes.filter(r => !hasId(r)).length,
    missingLessonNumber: minutes.filter(r => !r.lesson_number?.trim()).length,
    duplicateDriveIds: groups(minutes, r => hasId(r) ? r.drive_file_id.trim() : null),
    sameDaySources: groups(minutes, r => `${r.student_id}/${r.lesson_date}`),
    unknownStudentIds: [...new Set(minutes.filter(r => !known.has(r.student_id)).map(r => r.student_id))],
    generatedCharacters: statistics(minutes.map(r => Number(r.generated_chars))),
    transcriptCharacters: statistics(minutes.map(r => Number(r.transcript_chars))),
    maxStudentGeneratedCharacters: Math.max(0, ...Object.values(perStudentCharacters).map(c => c.generated)),
    maxStudentTranscriptCharacters: Math.max(0, ...Object.values(perStudentCharacters).map(c => c.transcript)),
    perStudentCharacters, students, minutes };
}

export function reconcileInventory(drive, db) {
  if (!drive || !db) return { status: 'unmeasured', reason: 'Both Drive and DB inventories are required' };
  drive = resolveDriveStudents(drive, db.students);
  const importedIds = new Set(db.minutes.map(r => r.drive_file_id?.trim()).filter(Boolean));
  const unmatched = drive.documents.filter(d => !importedIds.has(d.id));
  const known = new Set(db.students);
  const candidates = [];
  for (const d of drive.documents) {
    const rows = db.minutes.filter(m => d.studentId && d.date && m.student_id === d.studentId && m.lesson_date === d.date && m.drive_file_id?.trim() !== d.id);
    if (rows.length) candidates.push({ fileId: d.id, minutesIds: rows.map(m => m.id) });
  }
  return { status: drive.complete ? 'measured' : 'partial', totalDriveDocs: drive.totalDocs,
    existingMinutes: db.totalMinutes, matchedDriveDocs: drive.totalDocs - unmatched.length,
    notImportedByFileId: unmatched.length, unmatchedFileIds: unmatched.map(d => d.id),
    sameDaySourceCandidates: candidates,
    unmatchedFolders: drive.unmatchedFolders,
    typoSuspects: drive.typoSuspects,
    multiFolderDocs: drive.multiFolderDocs,
    conflictingStudentAssignments: drive.documents.flatMap(d => [...new Set(d.folders
      .map(f => f.resolvedStudentId).filter(id => id !== null))].flatMap(id => db.minutes
      .filter(m => m.drive_file_id?.trim() === d.id && m.student_id !== id)
      .map(m => ({ fileId: d.id, minutesId: m.id, driveStudentId: id, minutesStudentId: m.student_id })))),
    unknownStudentIds: [...new Set([...db.unknownStudentIds, ...Object.keys(drive.perStudent).filter(id => !known.has(id))])],
    note: 'Unmatched by file ID may already exist in minutes without a file ID; same-day candidates require review. Counts overlap.' };
}

// Only exact, unambiguous student assignments contribute. Missing measurements are
// explicitly counted; partial sums are never presented as complete student totals.
export function summarizeStudentCharacters(documents, studentIds, listingComplete, resolutionComplete) {
  const perStudent = Object.create(null);
  for (const id of studentIds) perStudent[id] = { documents: 0, measured: 0, characters: 0, byMode: Object.create(null) };
  let unresolvedDocuments = 0;
  for (const doc of documents) {
    const row = perStudent[doc.resolvedStudentId];
    if (!row || doc.resolvedStudentId == null) { unresolvedDocuments++; continue; }
    row.documents++;
    if (!doc.measurement) continue;
    row.measured++;
    row.characters += doc.measurement.characters;
    const mode = doc.measurement.mode;
    const group = row.byMode[mode] ||= { count: 0, characters: 0 };
    group.count++;
    group.characters += doc.measurement.characters;
  }
  const rows = Object.values(perStudent);
  const complete = Boolean(resolutionComplete && listingComplete && rows.every(r => r.documents === r.measured));
  return { complete, unresolvedDocuments, perStudent,
    measuredCharactersPerStudent: statistics(rows.map(r => r.characters)),
    fullPopulationCharactersPerStudent: complete ? statistics(rows.map(r => r.characters)) : null,
    note: 'All-period metadata listing refreshed on every run. Per-student totals exclude unresolved/conflicting assignments. Measured sums include fallback text; byMode separates extraction modes.' };
}
