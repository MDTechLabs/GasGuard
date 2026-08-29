/**
 * Soroban Serialization Cost Analyzer (#774)
 *
 * Detects expensive serialization / deserialization patterns:
 *  - Repeated to_xdr / from_xdr calls on the same value
 *  - Large struct types passed by value through serialization boundaries
 *  - Unnecessary conversions (e.g., String → Bytes → String)
 */

export interface SerializationFinding {
  rule: string;
  line: number;
  message: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
}

/** Patterns that indicate a (de)serialization operation */
const SERIALIZE_PATTERNS = [
  { regex: /\.to_xdr\s*\(/, label: 'to_xdr' },
  { regex: /\.from_xdr\s*\(/, label: 'from_xdr' },
  { regex: /ScVal::from\s*\(/, label: 'ScVal::from' },
  { regex: /ScVal::into\s*\(/, label: 'ScVal::into' },
  { regex: /Bytes::from_slice\s*\(/, label: 'Bytes::from_slice' },
  { regex: /String::from_slice\s*\(/, label: 'String::from_slice' },
  { regex: /\.serialize\s*\(/, label: 'serialize' },
  { regex: /\.deserialize\s*\(/, label: 'deserialize' },
];

/** Heuristic: large struct literals with many fields */
const LARGE_STRUCT_THRESHOLD = 5;
const STRUCT_FIELD_PATTERN = /\w+\s*:\s*\w+/g;

function detectRepeatedSerializations(source: string): SerializationFinding[] {
  const findings: SerializationFinding[] = [];
  const lines = source.split('\n');

  // Map: serialization-key → first line seen
  const seen = new Map<string, number>();

  let currentFn = '<unknown>';
  const fnPattern = /fn\s+([a-zA-Z0-9_]+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnMatch = line.match(fnPattern);
    if (fnMatch) {
      currentFn = fnMatch[1];
      seen.clear(); // reset per function
    }

    for (const { regex, label } of SERIALIZE_PATTERNS) {
      if (regex.test(line)) {
        // Use the expression on the left as part of the key
        const exprMatch = line.match(/([a-zA-Z0-9_]+)\s*\.\w+\s*\(/);
        const expr = exprMatch ? exprMatch[1] : `line${i}`;
        const key = `${currentFn}::${label}(${expr})`;

        if (seen.has(key)) {
          findings.push({
            rule: 'soroban-repeated-serialization',
            line: i + 1,
            message: `Repeated '${label}' on '${expr}' in function '${currentFn}' (first seen at line ${seen.get(key)}).`,
            suggestion: `Cache the serialized result of '${expr}' in a local variable to avoid redundant CPU and memory costs.`,
            severity: 'medium',
          });
        } else {
          seen.set(key, i + 1);
        }
      }
    }
  }

  return findings;
}

function detectUnnecessaryConversions(source: string): SerializationFinding[] {
  const findings: SerializationFinding[] = [];
  const lines = source.split('\n');

  // Detect chained conversions: e.g., .to_string().as_bytes() or Bytes → String → Bytes
  const chainPatterns = [
    {
      pattern: /\.to_string\(\).*\.as_bytes\(\)/,
      message: 'Unnecessary String→bytes conversion chain.',
      suggestion: 'Work directly with Bytes instead of converting to String first.',
    },
    {
      pattern: /from_xdr.*to_xdr|to_xdr.*from_xdr/,
      message: 'Serialize then immediately deserialize (or vice versa) is redundant.',
      suggestion: 'Pass the original value directly instead of round-tripping through XDR.',
    },
    {
      pattern: /String::from_slice.*Bytes::from_slice|Bytes::from_slice.*String::from_slice/,
      message: 'Redundant type conversion between String and Bytes.',
      suggestion: 'Choose one representation and avoid converting back and forth.',
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, message, suggestion } of chainPatterns) {
      if (pattern.test(line)) {
        findings.push({
          rule: 'soroban-unnecessary-conversion',
          line: i + 1,
          message,
          suggestion,
          severity: 'low',
        });
      }
    }
  }

  return findings;
}

function detectLargeSerializedValues(source: string): SerializationFinding[] {
  const findings: SerializationFinding[] = [];
  const lines = source.split('\n');

  let inStruct = false;
  let structStart = 0;
  let fieldCount = 0;
  let structName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect struct literal being passed to a serialization call
    if (!inStruct && SERIALIZE_PATTERNS.some(({ regex }) => regex.test(line))) {
      const structMatch = line.match(/(\w+)\s*\{/);
      if (structMatch) {
        inStruct = true;
        structStart = i + 1;
        structName = structMatch[1];
        fieldCount = 0;
      }
    }

    if (inStruct) {
      const fields = line.match(STRUCT_FIELD_PATTERN);
      if (fields) fieldCount += fields.length;
      if (line.includes('}')) {
        if (fieldCount >= LARGE_STRUCT_THRESHOLD) {
          findings.push({
            rule: 'soroban-large-serialized-value',
            line: structStart,
            message: `Large struct '${structName}' with ${fieldCount} fields is serialized. Large serialized values increase Soroban CPU and memory costs.`,
            suggestion:
              'Consider splitting the struct, serializing only the fields that change, or using a more compact representation.',
            severity: 'high',
          });
        }
        inStruct = false;
      }
    }
  }

  return findings;
}

export interface SerializationAnalysisResult {
  findings: SerializationFinding[];
}

/**
 * Analyze Soroban contract source for serialization cost issues (#774).
 */
export function analyzeSerializationCosts(source: string): SerializationAnalysisResult {
  const findings: SerializationFinding[] = [
    ...detectRepeatedSerializations(source),
    ...detectUnnecessaryConversions(source),
    ...detectLargeSerializedValues(source),
  ];

  return { findings };
}
