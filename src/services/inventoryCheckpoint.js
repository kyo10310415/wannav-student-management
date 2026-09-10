import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// Local measurement metadata only. Never persist the text or raw API errors.
export function checkpointReader({ directory, namespace, readTranscript, onHit = () => {} }) {
  return async (id, document = {}) => {
    const version = document.modifiedTime;
    const key = createHash('sha256').update(JSON.stringify([namespace, id, version])).digest('hex');
    const path = join(directory, key + '.json');
    const valid = r => r?.schema === 1 && r.key === key && Number.isSafeInteger(r.characters) &&
      r.characters >= 0 && typeof r.fallback === 'boolean' && typeof r.extraction?.mode === 'string' &&
      (r.extraction.selectedTab === null || typeof r.extraction.selectedTab === 'string') &&
      Array.isArray(r.extraction.tabTitles) && r.extraction.tabTitles.every(t => typeof t === 'string') &&
      typeof r.extraction.apiFallback === 'boolean';
    if (version) {
      try {
        const cached = JSON.parse(await readFile(path, 'utf8'));
        if (valid(cached)) { onHit(); return cached; }
      } catch (e) {
        if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e;
      }
    }
    const result = await readTranscript(id, document);
    const record = { schema: 1, key, characters: Array.from(result.text).length,
      fallback: Boolean(result.fallback), extraction: {
        mode: result.extraction?.mode || 'unspecified',
        selectedTab: result.extraction?.selectedTab ?? null,
        tabTitles: result.extraction?.tabTitles ?? [],
        apiFallback: Boolean(result.extraction?.apiFallback)
      } };
    if (!valid(record)) throw new Error('INVALID_MEASUREMENT');
    // A missing modifiedTime cannot safely identify a reusable document version.
    if (version) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = path + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
    }
    return record;
  };
}
