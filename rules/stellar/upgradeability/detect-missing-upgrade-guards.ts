/**
 * Detect Missing Contract Upgrade Guards (#373)
 * Flags upgrade functions that lack admin/owner validation.
 */

export interface UpgradeGuardResult {
  detected: boolean;
  message: string;
  suggestion: string;
  flaggedFunctions: string[];
}

const UPGRADE_FUNCTION_NAMES = new Set(["upgrade", "update_contract", "set_wasm"]);
const UPGRADE_ACTION_PATTERN = /\bupdate_current_contract_wasm\s*\(/;
const AUTH_PATTERNS = [/require_auth/, /admin\.require_auth/, /only_admin/, /assert_admin/];

export function detectMissingUpgradeGuards(code: string): UpgradeGuardResult {
  const functions = Array.from(code.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*\(/g));
  const flaggedFunctions: string[] = [];

  for (let i = 0; i < functions.length; i++) {
    const fn = functions[i];
    const start = fn.index ?? 0;
    const end = functions[i + 1]?.index ?? code.length;
    const body = code.slice(start, end);
    if (!UPGRADE_FUNCTION_NAMES.has(fn[1]) && !UPGRADE_ACTION_PATTERN.test(body)) continue;
    if (!AUTH_PATTERNS.some((pattern) => pattern.test(body))) {
      flaggedFunctions.push(fn[1]);
    }
  }

  if (flaggedFunctions.length > 0) {
    return {
      detected: true,
      message: 'Upgrade method detected without admin authorization guard.',
      suggestion: 'Add `admin.require_auth()` or an equivalent role check before allowing contract upgrades.',
      flaggedFunctions,
    };
  }

  return {
    detected: false,
    message: functions.some((fn, i) => {
      const start = fn.index ?? 0;
      const end = functions[i + 1]?.index ?? code.length;
      return UPGRADE_FUNCTION_NAMES.has(fn[1]) || UPGRADE_ACTION_PATTERN.test(code.slice(start, end));
    })
      ? 'Upgrade guard present.'
      : 'No upgrade methods found.',
    suggestion: '',
    flaggedFunctions: [],
  };
}
