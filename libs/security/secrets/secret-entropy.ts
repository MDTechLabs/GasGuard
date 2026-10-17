/**
 * Hardcoded credential detection with entropy checks (#1174).
 *
 * Credential literals are found in two passes. First a cheap pattern pass looks
 * for assignments to credential-shaped names, or for well-known token prefixes.
 * Then a Shannon-entropy pass rejects values that are too short or too
 * repetitive to be a real secret, which is what keeps `password = "password"`
 * and placeholder strings out of the results.
 *
 * Nothing here performs I/O and no matched value is ever returned inside an
 * error or log message by callers of this module.
 */

export const CREDENTIAL_NAME_PATTERN =
  /\b(?:api[_-]?key|secret|token|passwd|password|private[_-]?key|access[_-]?key|client[_-]?secret)\b/i;

export const KNOWN_TOKEN_PREFIXES = [
  "AKIA",
  "ASIA",
  "ghp_",
  "github_pat_",
  "glpat-",
  "sk_live_",
  "sk_test_",
  "xoxb-",
  "xoxp-",
  "-----BEGIN",
];

export interface EntropyOptions {
  /** Minimum value length considered a credential. */
  minLength: number;
  /** Minimum Shannon entropy (bits per character) considered a credential. */
  minEntropy: number;
}

export const DEFAULT_ENTROPY_OPTIONS: EntropyOptions = {
  minLength: 12,
  minEntropy: 3.2,
};

export interface EntropyMatch {
  /** Value length; the value itself is intentionally not included. */
  length: number;
  entropy: number;
  /** True when the value matched a known token prefix. */
  knownPrefix: boolean;
}

/** Shannon entropy of `value`, in bits per character. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) {
    return 0;
  }

  const frequencies = new Map<string, number>();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function hasKnownPrefix(value: string): boolean {
  return KNOWN_TOKEN_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * Evaluate one candidate literal.
 *
 * A value is a credential when it carries a known token prefix, or when it is
 * long enough and has enough entropy to be a generated secret.
 */
export function evaluateCandidate(
  rawValue: string,
  options: Partial<EntropyOptions> = {},
): EntropyMatch | undefined {
  const config = { ...DEFAULT_ENTROPY_OPTIONS, ...options };
  const value = rawValue.replace(/^["']|["']$/g, "");
  const knownPrefix = hasKnownPrefix(value);

  if (value.length < config.minLength && !knownPrefix) {
    return undefined;
  }

  const entropy = shannonEntropy(value);
  if (!knownPrefix && entropy < config.minEntropy) {
    return undefined;
  }

  return { length: value.length, entropy, knownPrefix };
}

/**
 * Find credential literals in `line`.
 *
 * Returns one match per assignment or bare token literal found on the line.
 */
export function findCredentialLiterals(
  line: string,
  options: Partial<EntropyOptions> = {},
): EntropyMatch[] {
  const matches: EntropyMatch[] = [];
  const assignment = new RegExp(
    `${CREDENTIAL_NAME_PATTERN.source}\\s*[:=]\\s*["']?([^\\s"',;)]+)`,
    "i",
  );
  const assigned = assignment.exec(line);
  if (assigned) {
    const match = evaluateCandidate(assigned[1], options);
    if (match) {
      matches.push(match);
    }
  }

  for (const token of line.match(/[A-Za-z0-9_\-/+.]{12,}/g) ?? []) {
    const match = evaluateCandidate(token, options);
    if (match?.knownPrefix) {
      matches.push(match);
    }
  }

  return matches;
}

/** True when the line appears to hardcode a credential. */
export function hasHardcodedCredential(
  line: string,
  options: Partial<EntropyOptions> = {},
): boolean {
  return findCredentialLiterals(line, options).length > 0;
}
