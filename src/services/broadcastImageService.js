import sharp from 'sharp';

// Bound decoding work on the 512 MB service; never flatten an animation.
const INPUT_OPTIONS = { limitInputPixels: 25_000_000 };

export async function optimizeBroadcastImage(buffer, filename, contentType) {
  const original = { buffer, filename, contentType };
  try {
    const metadata = await sharp(buffer, INPUT_OPTIONS).metadata();
    if (metadata.format === 'gif' || metadata.pages > 1) return original;
    const optimized = await sharp(buffer, INPUT_OPTIONS)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    if (optimized.length >= buffer.length) return original;
    return {
      buffer: optimized,
      filename: filename.replace(/\.[^.]*$/, '') + '.webp',
      contentType: 'image/webp'
    };
  } catch {
    // Keep previously accepted uploads usable when decoding/conversion is unsupported.
    return original;
  }
}
