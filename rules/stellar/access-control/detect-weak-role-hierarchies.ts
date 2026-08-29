/**
 * Detect Weak Role Hierarchies in Soroban Contracts
 * Flags role-assignment functions that lack a superior-authority check,
 * enabling any authenticated caller to escalate privileges.
 */

export interface WeakRoleHierarchyResult {
  detected: boolean;
  weakRoles: string[];
  message: string;
  suggestion: string;
}

// Functions that grant, assign, or promote roles
const ROLE_ASSIGN_PATTERNS = [
  /fn\s+(grant_role|assign_role|set_role|add_role|promote|escalate_role|make_admin|add_admin|give_admin|grant_admin|set_admin|transfer_role)\s*\(/g,
];

// A proper hierarchy guard verifies the CALLER holds a superior role before granting any role
const HIERARCHY_GUARD =
  /admin\.require_auth|only_admin|assert_admin|is_admin\(|require_role\s*\(\s*Role::Admin|env\.require_auth_for_admin|check_admin/;

// Basic auth present but no hierarchy check — caller identity confirmed but tier not verified
const WEAK_AUTH_GUARD = /require_auth/;

// Extract exactly one function body starting at startIdx by counting braces,
// avoiding false positives from adjacent function definitions.
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
  return code.slice(startIdx, startIdx + 400);
}

export function detectWeakRoleHierarchies(code: string): WeakRoleHierarchyResult {
  const weakRoles: string[] = [];

  for (const pattern of ROLE_ASSIGN_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const fnName = match[1];
      const fnBody = extractFunctionBody(code, match.index ?? 0);

      // Safe: a superior-authority guard validates the caller's role tier
      if (HIERARCHY_GUARD.test(fnBody)) continue;

      // Weak: only basic auth (any authenticated user can assign roles)
      // or no auth at all — both allow privilege escalation
      weakRoles.push(fnName);
    }
  }

  if (weakRoles.length === 0) {
    return {
      detected: false,
      weakRoles: [],
      message: 'Role hierarchy properly enforced on all role-assignment functions.',
      suggestion: '',
    };
  }

  const hasWeakAuth = WEAK_AUTH_GUARD.test(code);
  const escalationType = hasWeakAuth
    ? 'only basic require_auth (any authenticated user can assign roles)'
    : 'no authentication at all';

  return {
    detected: true,
    weakRoles,
    message: `Weak role hierarchy detected in: ${weakRoles.join(', ')}. Role-assignment functions use ${escalationType}.`,
    suggestion:
      'Guard every role-assignment function with a superior-authority check such as `admin.require_auth()` or `assert_admin(&env)` before modifying any role.',
  };
}
