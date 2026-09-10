import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpointReader } from '../src/services/inventoryCheckpoint.js';
import { resolveDriveStudents } from '../src/services/studentAiInventoryService.js';

test('resume persists metadata only; changed documents/code, corrupt files and missing versions are reread', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inventory-test-'));
  try {
    let calls = 0, hits = 0;
    const readTranscript = async () => {
      calls++;
      return { text: 'PRIVATE_BODY_😀', fallback: false,
        extraction: { mode: 'transcript_tab', selectedTab: '文字起こし', tabTitles: ['文字起こし'] } };
    };
    const make = namespace => checkpointReader({ directory, namespace, readTranscript, onHit: () => hits++ });
    await make('v1')('doc', { modifiedTime: 't1' });
    const file = join(directory, (await readdir(directory))[0]);
    assert.ok(!(await readFile(file, 'utf8')).includes('PRIVATE_BODY'));
    assert.equal((await make('v1')('doc', { modifiedTime: 't1' })).characters, 14);
    assert.equal(calls, 1);
    assert.equal(hits, 1);
    await make('v1')('doc', { modifiedTime: 't2' });
    await make('v2')('doc', { modifiedTime: 't1' });
    assert.equal(calls, 3);
    await writeFile(file, '{broken');
    await make('v1')('doc', { modifiedTime: 't1' });
    await make('v1')('no-version');
    await make('v1')('no-version');
    assert.equal(calls, 6);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('failed requests are not checkpointed and can be retried on next run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inventory-test-'));
  try {
    const options = { directory, namespace: 'v1' };
    await assert.rejects(checkpointReader({ ...options, readTranscript: async () => { throw new Error('synthetic'); } })('doc', { modifiedTime: 't1' }));
    assert.deepEqual(await readdir(directory), []);
    await checkpointReader({ ...options, readTranscript: async () => ({ text: 'ok', extraction: { mode: 'last_tab_fallback' } }) })('doc', { modifiedTime: 't1' });
    assert.equal((await readdir(directory)).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('student aggregation separates modes and unresolved assignments; partial totals stay partial', () => {
  const folders = [{ id: 'a', name: 'old-format' }, { id: 'b', name: 'unknown' }];
  const doc = (id, folderId, folderName, measurement) => ({ id, folders: [{ folderId, folderName }], measurement });
  const inventory = { complete: true, failures: [], folders, documents: [
    doc('1', 'a', 'old-format', { characters: 100, mode: 'transcript_tab' }),
    doc('2', 'a', 'old-format', { characters: 10, mode: 'last_tab_fallback' }),
    doc('3', 'b', 'unknown', { characters: 999, mode: 'transcript_tab' })
  ] };
  const result = resolveDriveStudents(inventory, ['old-format']).studentCharacterInventory;
  assert.equal(result.fullPopulationCharactersPerStudent.max, 110);
  assert.equal(result.unresolvedDocuments, 1);
  assert.equal(result.perStudent['old-format'].byMode.transcript_tab.characters, 100);
  assert.equal(result.perStudent['old-format'].byMode.last_tab_fallback.characters, 10);
  delete inventory.documents[1].measurement;
  const partial = resolveDriveStudents(inventory, ['old-format']).studentCharacterInventory;
  assert.equal(partial.complete, false);
  assert.equal(partial.fullPopulationCharactersPerStudent, null);
  assert.equal(partial.measuredCharactersPerStudent.max, 100);
  assert.equal(resolveDriveStudents(inventory, null).studentCharacterInventory.complete, false);
});
