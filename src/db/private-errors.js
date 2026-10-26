const operations = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'BEGIN', 'COMMIT', 'ROLLBACK', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'SAVEPOINT', 'RELEASE']);
const networkCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);

export function getQueryLogMetadata(text, duration, rowCount) {
  const word = typeof text === 'string' ? text.trimStart().match(/^[A-Za-z]+/)?.[0].toUpperCase() : undefined;
  const metadata = { operation: operations.has(word) ? word : 'OTHER', duration: Number.isFinite(duration) ? Math.max(0, duration) : 0 };
  if (Number.isSafeInteger(rowCount) && rowCount >= 0) metadata.rows = rowCount;
  return metadata;
}

export function privateDatabaseError(error, message) {
  const safe = new Error(message);
  // Preserve canonical SQLSTATE/network codes for callers, never provider details
  // or cause/config/query objects that may carry credentials or personal data.
  if (typeof error?.code === 'string' && (/^[0-9A-Z]{5}$/.test(error.code) || networkCodes.has(error.code))) safe.code = error.code;
  return safe;
}
