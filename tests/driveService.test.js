import test from 'node:test';
import assert from 'node:assert/strict';

import { findStudentFolder } from '../src/services/driveService.js';

test('findStudentFolder searches by student id instead of listing only the first 500 folders', async () => {
  let receivedOptions;
  const drive = {
    files: {
      async list(options) {
        receivedOptions = options;
        return {
          data: {
            files: [
              { id: 'prefix-folder', name: 'OLTS251097-SR-old' },
              { id: 'exact-folder', name: 'OLTS251097-SR' }
            ]
          }
        };
      }
    }
  };

  const folderId = await findStudentFolder(drive, 'parent-folder', 'OLTS251097-SR');

  assert.equal(folderId, 'exact-folder');
  assert.match(receivedOptions.q, /name contains 'OLTS251097-SR'/);
  assert.equal(receivedOptions.pageSize, 100);
});

test('findStudentFolder keeps the existing prefix-match fallback', async () => {
  const drive = {
    files: {
      async list() {
        return {
          data: {
            files: [{ id: 'prefixed-folder', name: 'OLTS251097-SR 石川流惺' }]
          }
        };
      }
    }
  };

  assert.equal(
    await findStudentFolder(drive, 'parent-folder', 'OLTS251097-SR'),
    'prefixed-folder'
  );
});
