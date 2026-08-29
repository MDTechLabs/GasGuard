/**
 * Detect Missing Contract Upgrade Guards (#373)
 * Flags upgrade functions that lack admin/owner validation.
 */

export interface UpgradeGuardResult {
  detected: boolean;
  message: string;
  suggestion: string;
}

const UPGRADE_PATTERNS = [/fn\s+upgrade\s*\(/, /fn\s+update_contract\s*\(/, /fn\s+set_wasm\s*\(/];
const AUTH_PATTERNS = [/require_auth/, /admin\.require_auth/, /only_admin/, /assert_admin/];

export function detectMissingUpgradeGuards(code: string): UpgradeGuardResult {
  const hasUpgradeMethod = UPGRADE_PATTERNS.some((p) => p.test(code));

  if (!hasUpgradeMethod) {
    return { detected: false, message: 'No upgrade methods found.', suggestion: '' };
  }

  const hasAuthCheck = AUTH_PATTERNS.some((p) => p.test(code));

  if (!hasAuthCheck) {
    return {
      detected: true,
      message: 'Upgrade method detected without admin authorization guard.',
      suggestion: 'Add `admin.require_auth()` or an equivalent role check before allowing contract upgrades.',
    };
  }

  return { detected: false, message: 'Upgrade guard present.', suggestion: '' };
}
