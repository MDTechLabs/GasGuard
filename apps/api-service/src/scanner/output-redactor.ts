/**
 * Redacts credentials from analyzer subprocess output before it is logged
 * or returned to callers.
 */

export const REDACTED = "[REDACTED]";

const PATTERNS: Array<[RegExp, string]> = [
  // Private key blocks.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  // Credentials embedded in URLs: scheme://user:pass@host
  [/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/g, `$1${REDACTED}@`],
  // Authorization / bearer headers.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // key=value / key: value secrets.
  [
    /\b([A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key|private[_-]?key|access[_-]?key)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"']+)/gi,
    `$1$2${REDACTED}`,
  ],
  // Well-known token formats.
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
  // 32-byte hex private keys (0x-prefixed).
  [/\b0x[a-fA-F0-9]{64}\b/g, REDACTED],
];

export function redactCredentials(output: string): string {
  let result = output;
  for (const [re, replacement] of PATTERNS) {
    result = result.replace(re, replacement);
  }
  return result;
}
