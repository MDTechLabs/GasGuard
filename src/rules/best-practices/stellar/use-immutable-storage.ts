export interface ImmutableStorageResult {
  detected: boolean;
  violations: Array<{
    functionName: string;
    storageKind: 'instance' | 'persistent' | 'temporary';
    access: 'set' | 'update' | 'remove';
    snippet: string;
  }>;
  message: string;
  suggestion: string;
}

const FN_WITH_READ_PREFIX = /fn\s+(get_|read_|fetch_|balance_|view_|check_|is_|has_)\w*\s*\(/g;

const MUTABLE_KEYWORDS = /set_|write_|store_|save_|update_|delete_|remove_/;

const STORAGE_WRITE = /env\.storage\(\)\.(instance|persistent|temporary)\(\)\.(set|update|remove|write)\(/g;

function extractFunctionBody(code: string, startIdx: number): string {
  let depth = 0;
  let opened = false;
  for (let i = startIdx; i < code.length; i++) {
    if (code[i] === '{') { depth++; opened = true; }
    else if (code[i] === '}') {
      depth--;
      if (opened && depth === 0) return code.slice(startIdx, i + 1);
    }
  }
  return '';
}

export function detectMutableStorageInView(code: string): ImmutableStorageResult {
  const violations: ImmutableStorageResult['violations'] = [];

  const matches = [...code.matchAll(FN_WITH_READ_PREFIX)];
  for (const match of matches) {
    const fnName = match[0].slice(3).split('(')[0];
    const startIdx = match.index ?? 0;
    const fnBody = extractFunctionBody(code, startIdx + match[0].length - 1);

    for (const writeMatch of fnBody.matchAll(STORAGE_WRITE)) {
      violations.push({
        functionName: fnName.trim(),
        storageKind: writeMatch[1] as 'instance' | 'persistent' | 'temporary',
        access: writeMatch[2] as 'set' | 'update' | 'remove',
        snippet: writeMatch[0].slice(0, 80),
      });
    }
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      message: 'No view-pure functions with storage writes detected.',
      suggestion: '',
    };
  }

  return {
    detected: true,
    violations,
    message: `${violations.length} function(s) perform storage writes despite appearing to be read-only.`,
    suggestion: 'Separate read-only (view) functions from state-mutating functions. For cached reads, use env.storage().instance().get() without writes.',
  };
}
