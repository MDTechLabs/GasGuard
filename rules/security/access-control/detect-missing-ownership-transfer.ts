export interface OwnershipTransferIssue {
  type: 'direct-assignment' | 'missing-two-step' | 'missing-zero-check';
  line: number;
  description: string;
  suggestion: string;
}

export interface OwnershipTransferResult {
  detected: boolean;
  issues: OwnershipTransferIssue[];
  message: string;
}

const OWNERSHIP_PATTERNS = [
  /(admin|owner|governance|manager)\s*=\s*(\w+)/gi,
  /transferOwnership\s*\(\s*(\w+)\s*\)/g,
  /setAdmin\s*\(\s*(\w+)\s*\)/g,
  /changeAdmin\s*\(\s*(\w+)\s*\)/g,
];

const TWO_STEP_PATTERNS = [
  /propose(?:Owner|Admin|Manager)/,
  /accept(?:Owner|Admin|Manager)/,
  /claim(?:Owner|Admin|Manager)/,
  /pending(?:Owner|Admin|Manager)/,
];

const ZERO_ADDRESS_PATTERN = /address\s*\(\s*0\s*\)|0x0+\s*$/;

export function detectMissingOwnershipTransfer(code: string): OwnershipTransferResult {
  const issues: OwnershipTransferIssue[] = [];
  const lines = code.split('\n');
  const codeLower = code.toLowerCase();

  const hasTwoStep = TWO_STEP_PATTERNS.some(p => p.test(code));
  const hasZeroCheck = ZERO_ADDRESS_PATTERN.test(code);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    for (const pattern of OWNERSHIP_PATTERNS) {
      const matches = trimmed.matchAll(pattern);
      for (const match of matches) {
        const target = match[1];
        const value = match[2];

        if (value === 'msg.sender') continue;

        if (!hasTwoStep) {
          issues.push({
            type: 'missing-two-step',
            line: lineNum,
            description: `Direct ownership transfer of \`${target}\` to \`${value}\` on line ${lineNum} without two-step pattern.`,
            suggestion: 'Use a two-step ownership transfer: first propose the new owner, then have them accept.',
          });
        }

        if (!hasZeroCheck && /owner|admin/i.test(target)) {
          issues.push({
            type: 'missing-zero-check',
            line: lineNum,
            description: `Ownership transfer of \`${target}\` does not validate the zero address.`,
            suggestion: 'Add a require statement to prevent transferring ownership to the zero address.',
          });
        }
      }
    }
  }

  if (issues.length === 0) {
    return { detected: false, issues: [], message: 'No unsafe ownership transfer patterns detected.' };
  }

  return {
    detected: true,
    issues,
    message: `${issues.length} unsafe ownership transfer pattern(s) detected.`,
  };
}
