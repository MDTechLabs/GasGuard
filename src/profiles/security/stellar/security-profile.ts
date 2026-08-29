import { SecurityCheck, SecurityProfileConfig, SecurityProfileResult } from './types';

export class StellarSecurityProfile {
  private source: string;
  private filePath: string;
  private config: SecurityProfileConfig;

  constructor(
    source: string,
    filePath: string,
    config: SecurityProfileConfig = { strictMode: false, failOnCritical: true, customChecks: [] },
  ) {
    this.source = source;
    this.filePath = filePath;
    this.config = config;
  }

  run(): SecurityProfileResult {
    const contractName = this.extractContractName();
    const builtinChecks = this.runBuiltinChecks();
    const checks = [...builtinChecks, ...this.config.customChecks];

    const passedCount = checks.filter(c => c.passed).length;
    const failedCount = checks.filter(c => !c.passed).length;
    const criticalIssues = checks.filter(c => !c.passed && c.severity === 'critical');
    const overallScore = checks.length > 0 ? Math.round((passedCount / checks.length) * 100) : 0;

    return {
      profileName: 'Soroban Security Baseline',
      contractName,
      checks,
      passedCount,
      failedCount,
      overallScore,
      criticalIssues,
      summary: this.generateSummary(contractName, passedCount, failedCount, overallScore, criticalIssues.length),
    };
  }

  private extractContractName(): string {
    const match = this.source.match(/pub struct (\w+)/)
      || this.source.match(/#\[contract\]\s*\n.*?pub\s+(?:struct|fn)\s+(\w+)/);
    return match ? match[1] : 'UnknownContract';
  }

  private runBuiltinChecks(): SecurityCheck[] {
    return [
      this.checkAuthorization(),
      this.checkInputValidation(),
      this.checkStorageSafety(),
      this.checkPanicUsage(),
      this.checkUnwrapUsage(),
      this.checkIntegerSafety(),
    ].filter(Boolean) as SecurityCheck[];
  }

  private checkAuthorization(): SecurityCheck {
    const hasAuth = this.source.includes('require_auth') || this.source.includes('.require_auth()');
    const hasAdminFn = this.source.match(/fn\s+(set_owner|change_admin|add_admin|remove_admin)/);

    const passed = hasAuth;
    return {
      id: 'SEC-001',
      name: 'Authorization Checks',
      description: 'Contract should use require_auth for privileged operations',
      severity: 'critical',
      category: 'access-control',
      passed,
      details: passed
        ? 'Authorization checks detected in contract'
        : 'No require_auth calls found. Privileged operations may be unprotected.',
      recommendation: passed
        ? 'Authorization is properly enforced'
        : 'Add require_auth() calls to all functions that modify sensitive state. Consider using a dedicated admin pattern.',
    };
  }

  private checkInputValidation(): SecurityCheck {
    const hasInputValidation = this.source.match(/if\s+\w+\s*(==|!=|<|>)\s*\w+/);
    const passed = hasInputValidation !== null;
    return {
      id: 'SEC-002',
      name: 'Input Validation',
      description: 'Functions should validate input parameters before processing',
      severity: 'high',
      category: 'input-validation',
      passed,
      details: passed
        ? 'Input validation patterns detected'
        : 'No explicit input validation found. Missing validation may lead to unexpected behavior.',
      recommendation: passed
        ? 'Input validation is present'
        : 'Add input validation at function entry points. Check bounds, ranges, and allowed values.',
    };
  }

  private checkStorageSafety(): SecurityCheck {
    const hasUnboundedStorage = this.source.match(/Vec|Map/)
      && !this.source.includes('limit') && !this.source.includes('max');
    const passed = !hasUnboundedStorage;
    return {
      id: 'SEC-003',
      name: 'Storage Safety',
      description: 'Storage should have bounds on collection sizes to prevent bloat',
      severity: 'medium',
      category: 'storage',
      passed,
      details: passed
        ? 'No unbounded storage patterns detected'
        : 'Contract uses Vec or Map without size limits. This could lead to storage bloat.',
      recommendation: passed
        ? 'Storage patterns appear safe'
        : 'Add maximum size limits to collections. Implement pagination for large data sets.',
    };
  }

  private checkPanicUsage(): SecurityCheck {
    const panicCount = (this.source.match(/\bpanic!\b/g) || []).length;
    const passed = panicCount === 0;
    return {
      id: 'SEC-004',
      name: 'Panic Usage',
      description: 'Use Result types instead of panic for error handling',
      severity: 'medium',
      category: 'logic',
      passed,
      details: passed
        ? 'No panic! calls detected'
        : `Found ${panicCount} panic! call(s). These will abort execution unconditionally.`,
      recommendation: passed
        ? 'Error handling uses Result types'
        : 'Replace panic! with Result<_, Error> for graceful error handling.',
    };
  }

  private checkUnwrapUsage(): SecurityCheck {
    const unwrapCount = (this.source.match(/\.unwrap\(\)/g) || []).length;
    const passed = unwrapCount <= 2;
    return {
      id: 'SEC-005',
      name: 'Safe Unwrapping',
      description: 'Excessive .unwrap() can cause unexpected panics',
      severity: 'high',
      category: 'logic',
      passed,
      details: passed
        ? `Found ${unwrapCount} .unwrap() call(s), within acceptable range`
        : `Found ${unwrapCount} .unwrap() call(s). Each can panic if the value is None or Err.`,
      recommendation: passed
        ? 'Unwrap usage is acceptable'
        : 'Replace .unwrap() with match or if-let patterns. Consider .unwrap_or() for defaults.',
    };
  }

  private checkIntegerSafety(): SecurityCheck {
    const hasArithmetic = this.source.match(/\w+\s*[+\-*/]\s*\w+/) !== null;
    const hasCheckedMath = this.source.includes('checked_') || this.source.includes('overflow');
    const passed = !hasArithmetic || hasCheckedMath;
    return {
      id: 'SEC-006',
      name: 'Integer Safety',
      description: 'Arithmetic operations should use checked math to prevent overflow',
      severity: 'high',
      category: 'crypto',
      passed,
      details: passed
        ? hasCheckedMath
          ? 'Checked arithmetic detected'
          : 'No arithmetic operations found'
        : 'Arithmetic operations found without overflow protection',
      recommendation: passed
        ? 'Integer safety is adequate'
        : 'Use checked_add, checked_mul, or similar safe arithmetic methods.',
    };
  }

  private generateSummary(
    name: string,
    passed: number,
    failed: number,
    score: number,
    criticalCount: number,
  ): string {
    const failedStr = failed > 0 ? ` ${failed} check(s) failed.` : ' All checks passed.';
    const criticalStr = criticalCount > 0 ? ` ${criticalCount} critical issue(s) found.` : '';
    return `Security baseline for "${name}": Score ${score}% (${passed} passed, ${failed} failed).${criticalStr}`;
  }
}
