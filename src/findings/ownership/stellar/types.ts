/**
 * Types for Soroban Finding Ownership Assignment
 *
 * Defines the type system for mapping findings to responsible modules/teams
 * and generating ownership assignment metadata.
 */

import { Finding } from "@engine/core";

/** A rule for assigning ownership based on finding attributes. */
export interface OwnershipRule {
  /** Unique identifier for this rule. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Team or module that owns findings matched by this rule. */
  owner: string;
  /** Glob-style file pattern to match (e.g. "contracts/token/**"). */
  filePattern?: string;
  /** Rule ID prefix to match (e.g. "stellar-storage-"). */
  ruleIdPrefix?: string;
  /** Severity levels this rule applies to. Empty means all. */
  severities?: Finding["severity"][];
}

/** Ownership metadata attached to a finding. */
export interface OwnershipAssignment {
  finding: Finding;
  owner: string;
  /** The rule that produced this assignment. */
  matchedRule: string;
  assignedAt: number;
}

/** Summary of ownership assignments for a set of findings. */
export interface OwnershipReport {
  total: number;
  assignments: OwnershipAssignment[];
  /** Counts per owner. */
  ownerBreakdown: Record<string, number>;
  /** Findings with no matching rule. */
  unassigned: Finding[];
}
