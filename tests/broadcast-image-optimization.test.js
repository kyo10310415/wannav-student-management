import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { optimizeBroadcastImage } from '../src/services/broadcastImageService.js';

test('large transparent image is smaller, bounded, and keeps its aspect ratio and alpha', async () => {
  const input = await sharp({ create: { width: 2400, height: 1200, channels: 4,
    background: { r: 80, g: 120, b: 200, alpha: 0.5 } } }).png().toBuffer();
  const result = await optimizeBroadcastImage(input, 'notice.png', 'image/png');
  const metadata = await sharp(result.buffer).metadata();
  assert.ok(result.buffer.length < input.length);
  assert.equal(result.filename, 'notice.webp');
  assert.equal(result.contentType, 'image/webp');
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 800);
  assert.equal(metadata.hasAlpha, true);
});

test('small images are never enlarged and output never grows', async () => {
  const input = await sharp({ create: { width: 16, height: 8, channels: 3,
    background: 'blue' } }).png().toBuffer();
  const result = await optimizeBroadcastImage(input, 'small.png', 'image/png');
  const metadata = await sharp(result.buffer).metadata();
  assert.ok(result.buffer.length <= input.length);
  assert.equal(metadata.width, 16);
  assert.equal(metadata.height, 8);
});

test('GIF and animated WebP retain their original bytes and filenames', async () => {
  const raw = Buffer.alloc(16 * 32 * 4, 128);
  raw.fill(240, 16 * 16 * 4);
  const image = () => sharp(raw, { raw: { width: 16, height: 32, channels: 4, pageHeight: 16 } });
  for (const [buffer, filename, contentType] of [
    [await image().gif({ delay: [100, 200], loop: 0 }).toBuffer(), 'motion.gif', 'image/gif'],
    [await image().webp({ delay: [100, 200], loop: 0 }).toBuffer(), 'motion.webp', 'image/webp']
  ]) {
    assert.equal((await sharp(buffer).metadata()).pages, 2);
    const result = await optimizeBroadcastImage(buffer, filename, contentType);
    assert.deepEqual(result, { buffer, filename, contentType });
  }
});

test('unsupported decoding retains the prior upload behavior', async () => {
  const buffer = Buffer.from('not decodable');
  assert.deepEqual(await optimizeBroadcastImage(buffer, 'original.png', 'image/png'),
    { buffer, filename: 'original.png', contentType: 'image/png' });
});
