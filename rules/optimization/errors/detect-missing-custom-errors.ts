/**
 * Detect Missing Custom Errors
 *
 * Detects contracts using revert strings instead of custom errors.
 * Custom errors are more gas efficient and reduce deployment size.
 */

export interface MissingCustomError {
  line: number;
  message: string;
  revertString: string;
}

export interface MissingCustomErrorsResult {
  detected: boolean;
  errors: MissingCustomError[];
  message: string;
  suggestion: string;
}

function stripComments(code: string): string {
  let result = '';
  let inBlockComment = false;
  const lines = code.split('\n');

  for (const line of lines) {
    if (!inBlockComment) {
      const blockCommentStart = line.indexOf('/*');
      const blockCommentEnd = line.indexOf('*/');

      if (blockCommentStart !== -1 && blockCommentEnd !== -1 && blockCommentStart < blockCommentEnd) {
        result += line.substring(0, blockCommentStart) + line.substring(blockCommentEnd + 2);
      } else if (blockCommentStart !== -1) {
        inBlockComment = true;
        result += line.substring(0, blockCommentStart);
      } else if (line.trim().startsWith('//')) {
        continue;
      } else {
        result += line;
      }
    } else {
      const blockCommentEnd = line.indexOf('*/');
      if (blockCommentEnd !== -1) {
        inBlockComment = false;
        result += line.substring(blockCommentEnd + 2);
      }
    }
  }

  return result;
}

function hasCustomErrors(code: string): boolean {
  return /error\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*;/.test(code);
}

function extractRevertStrings(code: string): MissingCustomError[] {
  const findings: MissingCustomError[] = [];
  const lines = code.split('\n');

  const revertStringPattern = /(revert\s*\(\s*["'])([^"']+)(["']\s*\)|\.?)|\brequire\s*\(\s*[^,]+,\s*["']([^"']+)["']\s*\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    let match;
    while ((match = revertStringPattern.exec(line)) !== null) {
      const revertString = match[2] || match[4];
      if (revertString) {
        findings.push({
          line: i + 1,
          message: `Revert string "${revertString}" detected. Consider using custom errors for gas efficiency.`,
          revertString,
        });
      }
    }
  }

  return findings;
}

export function detectMissingCustomErrors(code: string): MissingCustomErrorsResult {
  const strippedCode = stripComments(code);
  const hasCustomErrorDefinitions = hasCustomErrors(strippedCode);
  const revertFindings = extractRevertStrings(strippedCode);

  const revertStrings = revertFindings.filter(f => !hasCustomErrorDefinitions);

  if (revertStrings.length === 0) {
    return {
      detected: false,
      errors: [],
      message: 'No missing custom error opportunities detected.',
      suggestion: '',
    };
  }

  return {
    detected: true,
    errors: revertStrings,
    message: `${revertStrings.length} revert string(s) detected. Consider using custom errors: ${revertStrings.map(e => e.revertString).join(', ')}.`,
    suggestion: 'Define custom errors using the `error` keyword and use them with `revert CustomError()` instead of revert strings.',
  };
}