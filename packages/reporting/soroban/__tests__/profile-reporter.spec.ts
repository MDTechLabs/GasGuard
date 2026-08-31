/**
 * Issue #905 — Tests for Soroban Profile Reporter
 */

import * as fs from 'fs';
import * as path from 'path';
import { profileSorobanEntryPoints } from '../../../analyzers/soroban/entrypoints/profile/entry-point-profiler';
import { SorobanProfileReporter, generateProfileReport } from '../profile-reporter';

describe('SorobanProfileReporter (#905)', () => {
  const sampleContract = `
    #![no_std]
    use soroban_sdk::{contract, contractimpl, Env, Address, Vec, Symbol, symbol_short};

    #[contract]
    pub struct Vault;

    #[contractimpl]
    impl Vault {
        pub fn deposit(env: Env, from: Address, amount: i128) {
            from.require_auth();
            env.storage().instance().set(&symbol_short!("balance"), &amount);
            let client = TokenClient::new(&env, &token_addr);
            client.transfer(&from, &env.current_contract_address(), &amount);
        }

        pub fn process_queue(env: Env, items: Vec<Address>) {
            for item in items.iter() {
                for j in 0..10 {
                    let _ = sha256(&env, &item);
                    env.storage().persistent().set(&item, &1);
                }
            }
            env.invoke_contract(&addr, &symbol_short!("notify"), &args);
        }

        pub fn get_status(env: Env) -> bool {
            env.storage().instance().get(&symbol_short!("status")).unwrap_or(true)
        }
    }
  `;

  let report: ReturnType<typeof profileSorobanEntryPoints>;
  let reporter: SorobanProfileReporter;

  beforeEach(() => {
    report = profileSorobanEntryPoints(sampleContract, 'vault.rs');
    reporter = new SorobanProfileReporter();
  });

  it('generates a comprehensive Markdown report by default', () => {
    const md = reporter.generate(report, { format: 'markdown', projectName: 'VaultProject' });

    expect(md).toContain('# 🛡️ Soroban Entry-Point Resource Profile Report');
    expect(md).toContain('**Contract:** `Vault`');
    expect(md).toContain('**Project:** VaultProject');
    expect(md).toContain('## 📋 Executive Summary');
    expect(md).toContain('## 🏆 Ranked Entry-Point Resource Costs');
    expect(md).toContain('## 🔍 Detailed Entry-Point Profiles');
    expect(md).toContain('`process_queue()`');
    expect(md).toContain('`deposit()`');
    expect(md).toContain('`get_status()`');
    expect(md).toContain('Resource Category Breakdown');
  });

  it('generates structured JSON output', () => {
    const jsonStr = reporter.generate(report, { format: 'json' });
    const parsed = JSON.parse(jsonStr);

    expect(parsed.meta.contractName).toBe('Vault');
    expect(parsed.meta.filePath).toBe('vault.rs');
    expect(parsed.rankedEntryPoints).toHaveLength(3);
    expect(parsed.rankedEntryPoints[0].name).toBe('process_queue');
    expect(parsed.aggregateMetrics.totalEstimatedCost).toBeGreaterThan(0);
  });

  it('generates valid HTML output with styling', () => {
    const html = reporter.generate(report, { format: 'html' });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Vault — Soroban Entry-Point Profile Report');
    expect(html).toContain('<code>process_queue()</code>');
    expect(html).toContain('badge-critical');
    expect(html).toContain('meter-bar');
  });

  it('generates plain text CLI output', () => {
    const text = reporter.generate(report, { format: 'text' });

    expect(text).toContain('GASGUARD SOROBAN ENTRY-POINT RESOURCE PROFILER REPORT');
    expect(text).toContain('Contract:  Vault');
    expect(text).toContain('RANK  ENTRY POINT');
    expect(text).toContain('process_queue()');
  });

  it('filters by topExpensiveLimit and minCostTier correctly', () => {
    const top1 = reporter.generate(report, {
      format: 'markdown',
      topExpensiveLimit: 1,
    });
    expect(top1).toContain('#1 `process_queue()`');
    expect(top1).not.toContain('#2 `deposit()`');

    const criticalOnly = reporter.generate(report, {
      format: 'json',
      minCostTier: 'critical',
    });
    const parsed = JSON.parse(criticalOnly);
    expect(parsed.rankedEntryPoints.every((e: any) => e.costTier === 'critical')).toBe(true);
  });

  it('saves report to a specified output file path', async () => {
    const testDir = path.join(__dirname, 'temp');
    const testFile = path.join(testDir, 'test-report.md');

    try {
      const savedPath = await reporter.saveReport(report, {
        format: 'markdown',
        outputPath: testFile,
      });

      expect(savedPath).toBe(testFile);
      expect(fs.existsSync(testFile)).toBe(true);
      const content = fs.readFileSync(testFile, 'utf8');
      expect(content).toContain('Soroban Entry-Point Resource Profile Report');
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
      if (fs.existsSync(testDir)) {
        fs.rmdirSync(testDir);
      }
    }
  });

  it('standalone generateProfileReport function works identically', () => {
    const md = generateProfileReport(report);
    expect(md).toContain('# 🛡️ Soroban Entry-Point Resource Profile Report');
  });
});
