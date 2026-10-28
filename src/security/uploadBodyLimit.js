// Keep the existing 8 MiB image contract plus 1 MiB for multipart headers/fields.
export const BROADCAST_IMAGE_REQUEST_MAX_BYTES = 9 * 1024 * 1024;

export function uploadRequestBodyLimit(maxBytes = BROADCAST_IMAGE_REQUEST_MAX_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid upload body limit');
  return async (c, next) => {
    const raw = c.req.raw;
    if (!raw.body) return next();
    const tooLarge = () => c.json({ success: false, error: 'Image upload request too large' }, 413);
    const declared = raw.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
      void raw.body.cancel().catch(() => {});
      return tooLarge();
    }
    // Count the stream even when a smaller Content-Length was supplied.
    const reader = raw.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          void reader.cancel().catch(() => {});
          return tooLarge();
        }
        chunks.push(value);
      }
    } catch {
      void reader.cancel().catch(() => {});
      return c.json({ success: false, error: 'Invalid image upload request' }, 400);
    } finally {
      reader.releaseLock();
    }
    // Multipart parsing starts only after the complete body is known to fit.
    c.req.raw = new Request(raw, {
      body: new ReadableStream({ start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      } }),
      duplex: 'half'
    });
    return next();
  };
}

export const limitBroadcastImageUpload = uploadRequestBodyLimit();
