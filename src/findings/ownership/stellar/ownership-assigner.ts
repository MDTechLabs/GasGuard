/**
 * Soroban Finding Ownership Assigner
 *
 * Maps findings to responsible modules or teams using configurable
 * ownership rules. Supports file-pattern, ruleId-prefix, and
 * severity-based matching.
 */

import { Finding } from "@engine/core";
import {
  OwnershipRule,
  OwnershipAssignment,
  OwnershipReport,
} from "./types";

export class FindingOwnershipAssigner {
  private rules: OwnershipRule[];

  constructor(rules: OwnershipRule[] = []) {
    this.rules = rules;
  }

  /** Register a new ownership rule. */
  addRule(rule: OwnershipRule): void {
    this.rules.push(rule);
  }

  /** Assign ownership to a single finding. Returns null if no rule matches. */
  assignOne(finding: Finding): OwnershipAssignment | null {
    for (const rule of this.rules) {
      if (this.matches(finding, rule)) {
        return {
          finding,
          owner: rule.owner,
          matchedRule: rule.id,
          assignedAt: Date.now(),
        };
      }
    }
    return null;
  }

  /**
   * Assign ownership to a list of findings and produce a report.
   */
  assign(findings: Finding[]): OwnershipReport {
    const assignments: OwnershipAssignment[] = [];
    const unassigned: Finding[] = [];
    const ownerBreakdown: Record<string, number> = {};

    for (const finding of findings) {
      const assignment = this.assignOne(finding);
      if (assignment) {
        assignments.push(assignment);
        ownerBreakdown[assignment.owner] =
          (ownerBreakdown[assignment.owner] ?? 0) + 1;
      } else {
        unassigned.push(finding);
      }
    }

    return {
      total: findings.length,
      assignments,
      ownerBreakdown,
      unassigned,
    };
  }

  private matches(finding: Finding, rule: OwnershipRule): boolean {
    if (rule.severities && rule.severities.length > 0) {
      if (!rule.severities.includes(finding.severity)) return false;
    }

    if (rule.ruleIdPrefix && !finding.ruleId.startsWith(rule.ruleIdPrefix)) {
      return false;
    }

    if (rule.filePattern) {
      const file = finding.location.file;
      if (!this.matchGlob(rule.filePattern, file)) return false;
    }

    return true;
  }

  /** Minimal glob: supports `*` (single segment) and `**` (any depth). */
  private matchGlob(pattern: string, str: string): boolean {
    const re = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "§DOUBLE§")
      .replace(/\*/g, "[^/]*")
      .replace(/§DOUBLE§/g, ".*");
    return new RegExp(`^${re}$`).test(str);
  }
}
