/**
 * Fetch streams decoded bytes, while Content-Length describes the encoded body.
 * Return 0 when the decoded total is unknown or the advertised size is exceeded.
 * @param {{get(name: string): string | null}} headers
 * @param {number} loaded
 */
export function downloadTotal(headers, loaded = 0) {
  const encoding = headers.get('content-encoding');
  if (encoding !== null && encoding.trim().toLowerCase() !== 'identity') return 0;
  const length = headers.get('content-length')?.trim();
  if (!length || !/^\d+$/.test(length)) return 0;
  const total = Number(length);
  return Number.isSafeInteger(total) && total > 0 && loaded <= total ? total : 0;
}
