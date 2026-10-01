#!/usr/bin/env ts-node
/**
 * CLI entry-point for GasGuard dependency provenance checks (issue #1104).
 *
 * Usage:
 *   ts-node scripts/check-dependency-provenance.ts [options]
 *
 * Options:
 *   --npm <path>          Path to package-lock.json (default: ./package-lock.json)
 *   --pnpm <path>         Path to pnpm-lock.yaml  (provenance metadata parsed from it)
 *   --cargo <path>        Path to Cargo.lock       (default: ./Cargo.lock)
 *   --fail-on <severity>  critical|high|medium|low|info  (default: high)
 *   --require-repo-url    Flag packages without a repository URL
 *   --json                Output machine-readable JSON to stdout
 *   --exclude <name,...>  Comma-separated list of package names to skip
 *
 * Exit codes:
 *   0  All checks passed (or only violations below the fail threshold were found)
 *   1  One or more violations at or above the fail threshold
 *   2  Usage / configuration error
 */

import * as path from 'path';
import * as fs from 'fs';
import { DependencyProvenanceChecker } from '../libs/security/provenance/dependency-provenance-checker.service';
import {
  ProvenanceCheckResult,
  ProvenanceCheckerConfig,
  ProvViolationSeverity,
} from '../libs/security/provenance/interfaces';

// ---------------------------------------------------------------------------
// Argument parsing (no external libraries to keep deps minimal)
// ---------------------------------------------------------------------------

interface CliArgs {
  npmLockfile: string | null;
  cargoLockfile: string | null;
  failOn: ProvViolationSeverity;
  requireRepositoryUrl: boolean;
  jsonOutput: boolean;
  exclude: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    npmLockfile: null,
    cargoLockfile: null,
    failOn: 'high',
    requireRepositoryUrl: false,
    jsonOutput: false,
    exclude: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--npm':
      case '--pnpm':
        args.npmLockfile = argv[++i] ?? null;
        break;
      case '--cargo':
        args.cargoLockfile = argv[++i] ?? null;
        break;
      case '--fail-on':
        args.failOn = (argv[++i] as ProvViolationSeverity) ?? 'high';
        break;
      case '--require-repo-url':
        args.requireRepositoryUrl = true;
        break;
      case '--json':
        args.jsonOutput = true;
        break;
      case '--exclude': {
        const raw = argv[++i] ?? '';
        args.exclude = raw.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
      default:
        break;
    }
  }

  // Apply defaults if no explicit paths were given.
  if (!args.npmLockfile) {
    const candidates = ['package-lock.json', 'pnpm-lock.yaml'];
    for (const c of candidates) {
      if (fs.existsSync(path.resolve(c))) {
        args.npmLockfile = c;
        break;
      }
    }
  }
  if (!args.cargoLockfile && fs.existsSync(path.resolve('Cargo.lock'))) {
    args.cargoLockfile = 'Cargo.lock';
  }

  return args;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🚨',
  high:     '🔴',
  medium:   '🟡',
  low:      '🔵',
  info:     'ℹ️ ',
};

function printResult(label: string, result: ProvenanceCheckResult): void {
  const status = result.passed ? '✅ PASSED' : '❌ FAILED';
  console.log(`\n── ${label} Provenance Check ── ${status}`);
  console.log(`   Packages checked : ${result.totalChecked}`);
  console.log(`   Violations       : ${result.violations.length}`);
  console.log(`   Checked at       : ${result.checkedAt}`);

  if (result.violations.length > 0) {
    console.log('\n   Violations:');
    for (const v of result.violations) {
      const emoji = SEVERITY_EMOJI[v.severity] ?? '  ';
      console.log(`   ${emoji} [${v.severity.toUpperCase()}] ${v.message}`);
      if (v.remediation) {
        console.log(`      Remediation: ${v.remediation}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const checker = new DependencyProvenanceChecker();
  const config: ProvenanceCheckerConfig = {
    failOnSeverity: args.failOn,
    requireRepositoryUrl: args.requireRepositoryUrl,
    exclude: args.exclude,
  };

  const results: { label: string; result: ProvenanceCheckResult }[] = [];
  let anyFailure = false;

  if (args.npmLockfile) {
    try {
      const result = await checker.checkNpmLockfile(args.npmLockfile, config);
      results.push({ label: 'npm', result });
      if (!result.passed) anyFailure = true;
    } catch (err) {
      console.error(`Error checking npm lockfile: ${String(err)}`);
      process.exit(2);
    }
  }

  if (args.cargoLockfile) {
    try {
      const result = await checker.checkCargoLockfile(args.cargoLockfile, config);
      results.push({ label: 'Cargo', result });
      if (!result.passed) anyFailure = true;
    } catch (err) {
      console.error(`Error checking Cargo lockfile: ${String(err)}`);
      process.exit(2);
    }
  }

  if (results.length === 0) {
    console.error('No lockfiles found. Provide --npm or --cargo flags.');
    process.exit(2);
  }

  if (args.jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const { label, result } of results) {
      printResult(label, result);
    }
    console.log();
  }

  process.exit(anyFailure ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
