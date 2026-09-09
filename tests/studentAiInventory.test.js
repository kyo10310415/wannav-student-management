import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { statistics, fileDate, recognizedStudentId, resolveFolder, resolveDriveStudents, similarIds, listAllFiles, collectDriveInventory as collectRaw,
  collectDatabaseInventory, summarizeDatabase, reconcileInventory } from '../src/services/studentAiInventoryService.js';
import { getTranscriptFromDoc } from '../src/services/driveService.js';

const student = 'OLWV260827-00';
const collectDriveInventory = options => collectRaw({ students: [student, 'OLWV260828-00'], ...options });
test('statistics handle empty, odd, even, p95 and max populations', () => {
  assert.deepEqual(statistics([]), { count: 0, total: 0, mean: null, median: null, p95: null, max: null });
  assert.equal(statistics([1, 4, 3, 2]).median, 2.5);
  assert.equal(statistics([4, 1, 2]).median, 2);
  assert.equal(statistics(Array.from({ length: 20 }, (_, i) => i + 1)).p95, 19);
});
test('dates preserve calendar days and reject invalid dates', () => {
  assert.equal(fileDate('memo 2026/09/01'), '2026-09-01');
  assert.equal(fileDate('memo 2026-02-30'), null);
  assert.equal(fileDate('memo'), null);
  assert.equal(fileDate('2024/02/29'), '2024-02-29');
});
test('student recognition is exact; similarities do not authorize assignment', () => {
  assert.equal(recognizedStudentId(student, [student]), student);
  assert.equal(recognizedStudentId(student + ' notes'), null);
  assert.equal(recognizedStudentId('other'), null);
  assert.equal(similarIds(student, 'OLWV260828-00'), true);
  assert.equal(similarIds(student, 'OLWV260888-00'), false);
  assert.equal(similarIds('ab', 'abc'), true);
});
test('Drive pagination follows all pages and deduplicates IDs', async () => {
  const calls = [];
  const drive = { files: { list: async q => { calls.push(q); return { data: q.pageToken
    ? { files: [{ id: '2' }, { id: '1' }] }
    : { files: [{ id: '1' }], nextPageToken: 'next' } }; } } };
  assert.equal((await listAllFiles(drive, 'parent', 'application/vnd.google-apps.folder')).length, 2);
  assert.equal(calls[1].pageToken, 'next');
  assert.match(calls[0].q, /trashed = false/);
});
test('Drive pagination rejects incomplete searches and loops', async () => {
  for (const data of [{ incompleteSearch: true }, { nextPageToken: 'same' }]) {
    await assert.rejects(listAllFiles({ files: { list: async () => ({ data }) } }, 'p', 'm'));
  }
});

function fakeDrive() {
  return { files: { list: async ({ q }) => ({ data: { files:
    q.includes("'parent'") ? [{ id: 'f1', name: student }, { id: 'f2', name: student }, { id: 'f3', name: 'misc' }]
      : q.includes("'f1'") ? [{ id: 'd1', name: '2026/09/01' }, { id: 'd2', name: '2026/09/01' }]
      : q.includes("'f2'") ? [{ id: 'd3', name: 'unknown' }] : [{ id: 'd4', name: '2025/01/01' }]
  } }) } };
}
test('Drive reports duplicates, invalid folders, dates, counts and Unicode character lengths', async () => {
  const result = await collectDriveInventory({ drive: fakeDrive(), parentFolderId: 'parent', textLimit: Infinity,
    readTranscript: async () => ({ text: 'あ😀', fallback: false }) });
  assert.equal(result.totalDocs, 4);
  assert.equal(result.studentFolderCount, 2);
  assert.equal(result.perStudent[student], 3);
  assert.equal(result.duplicateStudentFolders.length, 1);
  assert.equal(result.sameDayMultipleDocs[0].count, 2);
  assert.equal(result.unmatchedFolders[0].folderName, 'misc');
  assert.equal(result.oldestFileDate, '2025-01-01');
  assert.equal(result.newestFileDate, '2026-09-01');
  assert.equal(result.dateMissingCount, 1);
  assert.equal(result.characters.mean, 2);
  assert.equal(result.characters.fullPopulation, true);
  assert.ok(!JSON.stringify(result).includes('あ😀'));
});
test('sample and read errors never masquerade as full population', async () => {
  const sample = await collectDriveInventory({ drive: fakeDrive(), parentFolderId: 'parent', textLimit: 1,
    readTranscript: async () => ({ text: 'sample', fallback: true }) });
  assert.equal(sample.characters.fullPopulation, false);
  assert.equal(sample.characters.attempted, 1);
  assert.equal(sample.characters.fallbackCount, 1);
  const failed = await collectDriveInventory({ drive: fakeDrive(), parentFolderId: 'parent', textLimit: Infinity,
    readTranscript: async () => { throw Error('SECRET'); } });
  assert.equal(failed.complete, false);
  assert.equal(failed.characters.mean, null);
  assert.ok(!JSON.stringify(failed).includes('SECRET'));
});
test('failed folder listing is explicitly partial', async () => {
  const drive = fakeDrive(); const list = drive.files.list;
  drive.files.list = async params => { if (params.q.includes("'f2'")) throw Error('no access'); return list(params); };
  const r = await collectDriveInventory({ drive, parentFolderId: 'parent', textLimit: 0 });
  assert.equal(r.complete, false); assert.equal(r.failures[0].folderId, 'f2');
});

test('one file in different student folders is not silently assigned to either student', async () => {
  const drive = { files: { list: async ({ q }) => ({ data: { files: q.includes("'parent'")
    ? [{ id: 'f1', name: student }, { id: 'f2', name: 'OLWV260828-00' }]
    : [{ id: 'shared', name: '2026/09/01' }] } }) } };
  const r = await collectDriveInventory({ drive, parentFolderId: 'parent', textLimit: 0 });
  assert.equal(r.totalDocs, 1);
  assert.equal(r.multiFolderDocs.length, 1);
  assert.equal(r.documents[0].studentId, null);
  assert.equal(r.perStudent[student], 0);
});

const rows = [
  { id: 1, student_id: student, lesson_date: '2026-09-01', drive_file_id: 'd1', lesson_number: '1', generated_chars: 10, transcript_chars: 100 },
  { id: 2, student_id: student, lesson_date: '2026-09-01', drive_file_id: null, lesson_number: null, generated_chars: 0, transcript_chars: 20 },
  { id: 3, student_id: 'orphan', lesson_date: '2026-09-02', drive_file_id: 'd1', lesson_number: ' ', generated_chars: 5, transcript_chars: 30 },
];
test('DB aggregation tracks missing fields, duplicate sources, orphans and text totals', () => {
  const r = summarizeDatabase(rows, [student]);
  assert.equal(r.totalMinutes, 3); assert.equal(r.withDriveId, 2); assert.equal(r.withoutDriveId, 1);
  assert.equal(r.missingLessonNumber, 2); assert.equal(r.duplicateDriveIds.length, 1);
  assert.equal(r.sameDaySources.length, 1); assert.deepEqual(r.unknownStudentIds, ['orphan']);
  assert.equal(r.generatedCharacters.total, 15); assert.equal(r.transcriptCharacters.total, 150);
});
test('DB uses read-only snapshot, fetches only metadata/lengths, and rolls back', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push(sql);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(sql));
    if (sql.includes('FROM students')) return { rows: [{ student_id: student }] };
    if (sql.includes('FROM minutes')) {
      assert.match(sql, /CHAR_LENGTH/); assert.match(sql, /WHERE id > \$1/); assert.deepEqual(params, [0]);
      return { rows };
    }
    return { rows: [] };
  } };
  assert.equal((await collectDatabaseInventory(client)).totalMinutes, 3);
  assert.match(calls[0], /READ ONLY/); assert.equal(calls.at(-1), 'ROLLBACK');
});
test('DB read failures roll back and propagate', async () => {
  const calls = [];
  await assert.rejects(collectDatabaseInventory({ query: async sql => {
    calls.push(sql); if (sql.includes('FROM students')) throw Error('failure'); return { rows: [] };
  } }));
  assert.equal(calls.at(-1), 'ROLLBACK');
});
test('DB pagination advances the keyset cursor', async () => {
  const paramsSeen = [];
  const r = await collectDatabaseInventory({ query: async (sql, params) => {
    if (!sql.includes('FROM minutes')) return { rows: [] };
    paramsSeen.push(params[0]);
    return { rows: params[0] === 0 ? Array.from({ length: 1000 }, (_, i) => ({ ...rows[0], id: i + 1 })) : [] };
  } });
  assert.equal(r.totalMinutes, 1000); assert.deepEqual(paramsSeen, [0, 1000]);
});
test('reconciliation distinguishes file-ID unmatched, date candidates and identity conflicts', async () => {
  const drive = await collectDriveInventory({ drive: fakeDrive(), parentFolderId: 'parent', textLimit: 0 });
  const r = reconcileInventory(drive, summarizeDatabase(rows, [student]));
  assert.equal(r.notImportedByFileId, 3); assert.equal(r.matchedDriveDocs, 1);
  assert.ok(r.sameDaySourceCandidates.some(c => c.fileId === 'd2'));
  assert.equal(r.conflictingStudentAssignments.length, 1);
  assert.equal(reconcileInventory(null, null).status, 'unmeasured');
});
test('existing transcript tab extractor is reused with silent inventory logging', async () => {
  const docs = { documents: { get: async () => ({ data: { tabs: [{ tabProperties: { title: '文字起こし' }, documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'sample' } }] } }] } } }] } }) } };
  assert.equal(await getTranscriptFromDoc(docs, 'id', { log() {}, warn() { assert.fail('no fallback'); } }), 'sample');
});
test('standalone inventory has no generation/migration/startup dependency', async () => {
  const script = await readFile(new URL('../scripts/student-ai-inventory.js', import.meta.url), 'utf8');
  const imports = script.split('\n').filter(l => l.startsWith('import ')).join('\n');
  assert.doesNotMatch(imports, /minutesService|openai|migrate|index\.js/);
});

test('DB students are authoritative even for IDs outside the format regex', () => {
  for (const name of [student, 'legacy_123', '12345']) {
    const r = resolveFolder({ id: 'folder', name }, [student, 'legacy_123', '12345']);
    assert.equal(r.resolvedStudentId, name);
    assert.equal(r.status, 'matched');
    assert.deepEqual(r.candidates, []);
  }
  const r = resolveFolder({ id: 'folder', name: 'OLWV999999-99' }, [student]);
  assert.equal(r.status, 'unmatched');
  assert.equal(r.resolvedStudentId, null);
});

test('typo variants report candidates without automatic binding', () => {
  for (const name of ['0LWV260827-00', 'olwv260827-00', ' OLWV260827-00 ',
    'OLWV26082700', 'OLWV260827－00', 'OLWV260828-00']) {
    const r = resolveFolder({ id: 'folder', name }, [student]);
    assert.equal(r.folderName, name);
    assert.equal(r.status, 'possible_typo', name);
    assert.equal(r.resolvedStudentId, null);
    assert.deepEqual(r.candidates, [student]);
  }
});

test('raw folder relationships survive no-DB collection and DB reconciliation', async () => {
  const names = ['legacy_123', '0LWV260827-00'];
  const drive = { files: { list: async ({ q }) => ({ data: { files: q.includes("'parent'")
    ? names.map((name, i) => ({ id: `f${i}`, name }))
    : [{ id: q.includes("'f0'") ? 'legacyDoc' : 'typoDoc', name: '2026/09/01' }] } }) } };
  const raw = await collectRaw({ drive, parentFolderId: 'parent', textLimit: 0 });
  assert.equal(raw.studentFolderCount, null);
  assert.equal(raw.documents[0].folders[0].folderName, names[0]);
  const resolved = resolveDriveStudents(raw, ['legacy_123', student]);
  assert.equal(resolved.studentFolderCount, 1);
  assert.equal(resolved.unmatchedFolderCount, 1);
  assert.equal(resolved.perStudent.legacy_123, 1);
  assert.equal(resolved.documents.find(d => d.id === 'typoDoc').resolvedStudentId, null);
  const db = summarizeDatabase([{ ...rows[0], student_id: 'legacy_123', drive_file_id: null }], ['legacy_123', student]);
  const report = reconcileInventory(raw, db);
  assert.ok(report.sameDaySourceCandidates.some(c => c.fileId === 'legacyDoc'));
  assert.equal(report.typoSuspects[0].folderName, names[1]);
  assert.equal(report.unmatchedFolders.length, 1);
});

test('multi-folder documents retain all raw names and remain ambiguous', async () => {
  const raw = { folders: [{ id: 'f1', name: student }, { id: 'f2', name: 'legacy_123' }, { id: 'f3', name: '0LWV260827-00' }],
    documents: [{ id: 'doc', date: '2026-09-01', folders: [
      { folderId: 'f1', folderName: student }, { folderId: 'f2', folderName: 'legacy_123' },
      { folderId: 'f3', folderName: '0LWV260827-00' }] }] };
  const r = resolveDriveStudents(raw, [student, 'legacy_123']);
  assert.equal(r.documents[0].resolvedStudentId, null);
  assert.deepEqual(r.documents[0].folders.map(f => f.resolvedStudentId), [student, 'legacy_123', null]);
  assert.equal(r.documents[0].folders[2].status, 'possible_typo');
  assert.equal(r.multiFolderDocs.length, 1);
  const db = summarizeDatabase([{ ...rows[0], drive_file_id: 'doc' }], [student, 'legacy_123']);
  assert.equal(reconcileInventory({ ...raw, complete: true, totalDocs: 1 }, db).conflictingStudentAssignments[0].driveStudentId, 'legacy_123');
});
