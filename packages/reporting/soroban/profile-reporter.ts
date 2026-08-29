/**
 * Issue #905 — Soroban Entry-Point Profile Reporter
 *
 * Generates human-readable, machine-parseable, and CLI-ready resource profile
 * reports (Markdown, JSON, HTML, Text) from Soroban entry-point profiler output.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EntryPointProfile, EntryPointProfileReport, CostTier } from '../../analyzers/soroban/entrypoints/profile/types';
import { FormattedReportSummary, ProfileReportOptions } from './types';

const TIER_ORDER: Record<CostTier, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const TIER_BADGES: Record<CostTier, { emoji: string; label: string; textBadge: string }> = {
  critical: { emoji: '🔴', label: 'CRITICAL', textBadge: '[CRITICAL]' },
  high: { emoji: '🟠', label: 'HIGH', textBadge: '[HIGH]' },
  medium: { emoji: '🟡', label: 'MEDIUM', textBadge: '[MEDIUM]' },
  low: { emoji: '🟢', label: 'LOW', textBadge: '[LOW]' },
};

export class SorobanProfileReporter {
  /**
   * Generate entry-point profile report in the specified format.
   */
  public generate(report: EntryPointProfileReport, options: ProfileReportOptions = {}): string {
    const format = options.format || 'markdown';

    switch (format) {
      case 'json':
        return this.generateJSON(report, options);
      case 'html':
        return this.generateHTML(report, options);
      case 'text':
        return this.generateText(report, options);
      case 'markdown':
      default:
        return this.generateMarkdown(report, options);
    }
  }

  /**
   * Save generated report to filesystem.
   */
  public async saveReport(report: EntryPointProfileReport, options: ProfileReportOptions): Promise<string> {
    const content = this.generate(report, options);
    const ext = options.format === 'json' ? 'json' : options.format === 'html' ? 'html' : options.format === 'text' ? 'txt' : 'md';
    const outputPath = options.outputPath || `./soroban-profile-report-${Date.now()}.${ext}`;

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, content, 'utf8');
    return outputPath;
  }

  /**
   * Generate Markdown format report.
   */
  public generateMarkdown(report: EntryPointProfileReport, options: ProfileReportOptions = {}): string {
    const { contractName, filePath, aggregateMetrics, summary } = report;
    const includeRecs = options.includeRecommendations ?? true;
    const includeBreakdown = options.includeDetailedBreakdown ?? true;
    const includeHotspots = options.includeHotspots ?? true;
    const filteredProfiles = this.filterProfiles(report.rankedEntryPoints, options);

    let md = `# 🛡️ Soroban Entry-Point Resource Profile Report\n\n`;
    md += `**Contract:** \`${contractName}\`  \n`;
    md += `**Source File:** \`${filePath}\`  \n`;
    if (options.projectName) {
      md += `**Project:** ${options.projectName}  \n`;
    }
    const genDate = report.generatedAt instanceof Date ? report.generatedAt.toISOString() : String(report.generatedAt);
    md += `**Generated At:** ${genDate}  \n\n`;
    md += `---\n\n`;

    // Executive Summary
    md += `## 📋 Executive Summary\n\n`;
    md += `> ${summary}\n\n`;

    md += `### 📊 Aggregate Resource Metrics\n\n`;
    md += `| Metric | Value |\n`;
    md += `| :--- | :--- |\n`;
    md += `| **Total Entry Points Analyzed** | \`${report.totalEntryPoints}\` (${report.publicEntryPointsCount} public) |\n`;
    md += `| **Average Cost Score** | \`${aggregateMetrics.averageCost} / 100\` |\n`;
    md += `| **Mean CPU Impact Score** | \`${aggregateMetrics.totalCpuScore} / 100\` |\n`;
    md += `| **Mean Memory Impact Score** | \`${aggregateMetrics.totalMemoryScore} / 100\` |\n`;
    md += `| **Total Storage Reads** | \`${aggregateMetrics.totalStorageReads}\` |\n`;
    md += `| **Total Storage Writes** | \`${aggregateMetrics.totalStorageWrites}\` |\n`;
    md += `| **Total Contract / Token Calls** | \`${aggregateMetrics.totalContractCalls}\` |\n\n`;

    // Ranked Entry-Point Table
    md += `## 🏆 Ranked Entry-Point Resource Costs\n\n`;
    md += `Entry points ranked from most expensive to least expensive estimated execution cost.\n\n`;
    md += `| Rank | Entry Point | Visibility | Total Cost | Cost Tier | CPU | Memory | Storage | Calls |\n`;
    md += `| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

    for (const ep of report.rankedEntryPoints) {
      const badge = TIER_BADGES[ep.costTier];
      const nameCol = `\`${ep.name}()\``;
      const visCol = `\`${ep.visibility}\``;
      const costCol = `**${ep.totalEstimatedCost} / 100**`;
      const tierCol = `${badge.emoji} ${badge.label}`;
      const cpuCol = `${ep.cpu.score}`;
      const memCol = `${ep.memory.score}`;
      const storCol = `${ep.storage.score}`;
      const callCol = `${ep.contractCalls.score}`;

      md += `| ${ep.rank} | ${nameCol} | ${visCol} | ${costCol} | ${tierCol} | ${cpuCol} | ${memCol} | ${storCol} | ${callCol} |\n`;
    }
    md += `\n`;

    // Detailed Breakdown per Entry Point
    if (includeBreakdown && filteredProfiles.length > 0) {
      md += `## 🔍 Detailed Entry-Point Profiles\n\n`;

      for (const ep of filteredProfiles) {
        const badge = TIER_BADGES[ep.costTier];
        md += `### #${ep.rank} \`${ep.name}()\` — ${badge.emoji} ${badge.label} (Cost: ${ep.totalEstimatedCost}/100)\n\n`;
        md += `- **Line Number:** \`${ep.lineNumber}\` (${ep.bodyLines} body lines)\n`;
        md += `- **Visibility:** \`${ep.visibility}\`\n`;
        if (ep.params.length > 0) {
          md += `- **Parameters:** \`${ep.params.join(', ')}\`\n`;
        }
        if (ep.returnType) {
          md += `- **Return Type:** \`${ep.returnType}\`\n`;
        }
        md += `\n`;

        // Category breakdown table
        md += `#### Resource Category Breakdown\n\n`;
        md += `| Category | Score (0-100) | Key Metrics / Indicators |\n`;
        md += `| :--- | :---: | :--- |\n`;

        // CPU details
        const cpuNotes = [];
        if (ep.cpu.nestedLoops > 0) cpuNotes.push(`${ep.cpu.nestedLoops} nested loop(s)`);
        if (ep.cpu.unboundedLoops > 0) cpuNotes.push(`${ep.cpu.unboundedLoops} unbounded loop(s)`);
        if (ep.cpu.cryptoOperations > 0) cpuNotes.push(`${ep.cpu.cryptoOperations} crypto op(s)`);
        if (ep.cpu.collectionIterations > 0) cpuNotes.push(`${ep.cpu.collectionIterations} iter(s)`);
        if (ep.cpu.storageInLoops > 0) cpuNotes.push('storage in loop');
        const cpuNotesStr = cpuNotes.length > 0 ? cpuNotes.join(', ') : 'Standard execution path';
        md += `| **CPU Impact** | \`${ep.cpu.score}\` | ${cpuNotesStr} |\n`;

        // Memory details
        const memNotes = [];
        if (ep.memory.largeAllocations > 0) memNotes.push(`${ep.memory.largeAllocations} large alloc(s)`);
        if (ep.memory.nestedCollections > 0) memNotes.push('nested collections');
        if (ep.memory.cloneInLoops > 0) memNotes.push(`${ep.memory.cloneInLoops} clone(s) in loop`);
        if (ep.memory.boxAllocations > 0) memNotes.push(`${ep.memory.boxAllocations} heap Box`);
        const memNotesStr = memNotes.length > 0 ? memNotes.join(', ') : 'Minimal heap pressure';
        md += `| **Memory Impact** | \`${ep.memory.score}\` | ${memNotesStr} |\n`;

        // Storage details
        const storNotes = [];
        if (ep.storage.persistentWrites > 0) storNotes.push(`${ep.storage.persistentWrites} persistent write(s)`);
        if (ep.storage.instanceWrites > 0) storNotes.push(`${ep.storage.instanceWrites} instance write(s)`);
        if (ep.storage.readsCount > 0) storNotes.push(`${ep.storage.readsCount} read(s)`);
        if (ep.storage.storageInLoops > 0) storNotes.push('⚠️ storage in loop');
        const storNotesStr = storNotes.length > 0 ? storNotes.join(', ') : 'No direct state mutation';
        md += `| **Storage Impact** | \`${ep.storage.score}\` | ${storNotesStr} |\n`;

        // Contract Call details
        const callNotes = [];
        if (ep.contractCalls.crossContractInvocations > 0) callNotes.push(`${ep.contractCalls.crossContractInvocations} cross-contract call(s)`);
        if (ep.contractCalls.tokenTransfers > 0) callNotes.push(`${ep.contractCalls.tokenTransfers} token transfer(s)`);
        if (ep.contractCalls.balanceQueries > 0) callNotes.push(`${ep.contractCalls.balanceQueries} balance check(s)`);
        const callNotesStr = callNotes.length > 0 ? callNotes.join(', ') : 'No external calls';
        md += `| **Contract Calls** | \`${ep.contractCalls.score}\` | ${callNotesStr} |\n\n`;

        // Hotspots
        if (includeHotspots && ep.hotspots.length > 0) {
          md += `**Hotspots Detected:**\n`;
          for (const h of ep.hotspots) {
            md += `- ⚠️ ${h}\n`;
          }
          md += `\n`;
        }

        // Recommendations
        if (includeRecs && ep.recommendations.length > 0) {
          md += `**Optimization Recommendations:**\n`;
          for (const rec of ep.recommendations) {
            md += `- 💡 ${rec}\n`;
          }
          md += `\n`;
        }

        // Findings
        if (ep.findings.length > 0) {
          md += `**Specific Findings:**\n`;
          for (const f of ep.findings) {
            md += `- \`${f.ruleId}\` (${f.severity}): ${f.message}\n`;
          }
          md += `\n`;
        }

        md += `---\n\n`;
      }
    }

    md += `*Generated by GasGuard Soroban Entry-Point Resource Profiler*\n`;
    return md;
  }

  /**
   * Generate JSON format report.
   */
  public generateJSON(report: EntryPointProfileReport, options: ProfileReportOptions = {}): string {
    const filteredProfiles = this.filterProfiles(report.rankedEntryPoints, options);

    const output = {
      meta: {
        generator: 'GasGuard Soroban Entry-Point Resource Profiler',
        contractName: report.contractName,
        filePath: report.filePath,
        projectName: options.projectName ?? null,
        generatedAt: report.generatedAt instanceof Date ? report.generatedAt.toISOString() : report.generatedAt,
      },
      summary: report.summary,
      aggregateMetrics: report.aggregateMetrics,
      costThresholds: report.costThresholds,
      rankedEntryPoints: filteredProfiles,
    };

    return JSON.stringify(output, null, 2);
  }

  /**
   * Generate HTML format report with modern styling.
   */
  public generateHTML(report: EntryPointProfileReport, options: ProfileReportOptions = {}): string {
    const { contractName, filePath, aggregateMetrics, summary } = report;
    const filteredProfiles = this.filterProfiles(report.rankedEntryPoints, options);

    const rows = filteredProfiles
      .map((ep) => {
        const badge = TIER_BADGES[ep.costTier];
        const tierClass = ep.costTier;
        return `
        <tr>
          <td style="text-align:center;font-weight:bold;">${ep.rank}</td>
          <td><code>${ep.name}()</code></td>
          <td><span class="badge badge-vis">${ep.visibility}</span></td>
          <td style="font-weight:bold;">${ep.totalEstimatedCost} / 100</td>
          <td><span class="badge badge-${tierClass}">${badge.emoji} ${badge.label}</span></td>
          <td><div class="meter-bar"><div class="meter-fill" style="width:${ep.cpu.score}%;"></div><span>${ep.cpu.score}</span></div></td>
          <td><div class="meter-bar"><div class="meter-fill" style="width:${ep.memory.score}%;"></div><span>${ep.memory.score}</span></div></td>
          <td><div class="meter-bar"><div class="meter-fill" style="width:${ep.storage.score}%;"></div><span>${ep.storage.score}</span></div></td>
          <td><div class="meter-bar"><div class="meter-fill" style="width:${ep.contractCalls.score}%;"></div><span>${ep.contractCalls.score}</span></div></td>
        </tr>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${contractName} — Soroban Entry-Point Profile Report</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --border: #334155;
      --critical: #ef4444;
      --high: #f97316;
      --medium: #eab308;
      --low: #22c55e;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      margin: 0;
      padding: 24px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1, h2, h3 { color: #fff; margin-top: 0; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 16px 0; }
    .stat-box { background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 6px; padding: 12px; }
    .stat-val { font-size: 24px; font-weight: bold; color: #38bdf8; }
    .stat-lbl { font-size: 12px; color: var(--text-muted); text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: rgba(255,255,255,0.02); color: var(--text-muted); font-size: 13px; text-transform: uppercase; }
    code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .badge-critical { background: rgba(239, 68, 68, 0.2); color: var(--critical); border: 1px solid var(--critical); }
    .badge-high { background: rgba(249, 115, 22, 0.2); color: var(--high); border: 1px solid var(--high); }
    .badge-medium { background: rgba(234, 179, 8, 0.2); color: var(--medium); border: 1px solid var(--medium); }
    .badge-low { background: rgba(34, 197, 94, 0.2); color: var(--low); border: 1px solid var(--low); }
    .badge-vis { background: rgba(255,255,255,0.1); color: #cbd5e1; }
    .meter-bar { width: 80px; height: 16px; background: #334155; border-radius: 4px; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; }
    .meter-fill { position: absolute; left: 0; top: 0; bottom: 0; background: #38bdf8; opacity: 0.6; }
    .meter-bar span { position: relative; font-size: 10px; font-weight: bold; color: #fff; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>🛡️ Soroban Entry-Point Resource Profile</h1>
      <p style="color:var(--text-muted);">Contract: <code>${contractName}</code> | File: <code>${filePath}</code></p>
      <p><strong>Executive Summary:</strong> ${summary}</p>
      <div class="grid">
        <div class="stat-box"><div class="stat-val">${report.totalEntryPoints}</div><div class="stat-lbl">Entry Points</div></div>
        <div class="stat-box"><div class="stat-val">${aggregateMetrics.averageCost}</div><div class="stat-lbl">Average Cost / 100</div></div>
        <div class="stat-box"><div class="stat-val">${aggregateMetrics.totalStorageWrites}</div><div class="stat-lbl">Storage Writes</div></div>
        <div class="stat-box"><div class="stat-val">${aggregateMetrics.totalContractCalls}</div><div class="stat-lbl">Contract Calls</div></div>
      </div>
    </div>

    <div class="card">
      <h2>🏆 Ranked Entry-Point Costs</h2>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Entry Point</th>
            <th>Visibility</th>
            <th>Estimated Cost</th>
            <th>Cost Tier</th>
            <th>CPU</th>
            <th>Memory</th>
            <th>Storage</th>
            <th>Calls</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generate Plain Text / Terminal CLI format report.
   */
  public generateText(report: EntryPointProfileReport, options: ProfileReportOptions = {}): string {
    const { contractName, filePath, aggregateMetrics, summary } = report;
    const filteredProfiles = this.filterProfiles(report.rankedEntryPoints, options);

    let out = `================================================================================\n`;
    out += `  GASGUARD SOROBAN ENTRY-POINT RESOURCE PROFILER REPORT\n`;
    out += `================================================================================\n`;
    out += `Contract:  ${contractName}\n`;
    out += `File:      ${filePath}\n`;
    out += `Summary:   ${summary}\n`;
    out += `--------------------------------------------------------------------------------\n`;
    out += `Total Entry Points: ${report.totalEntryPoints} | Avg Cost: ${aggregateMetrics.averageCost}/100\n`;
    out += `Storage Writes:     ${aggregateMetrics.totalStorageWrites} | Storage Reads: ${aggregateMetrics.totalStorageReads}\n`;
    out += `Contract Calls:     ${aggregateMetrics.totalContractCalls}\n`;
    out += `--------------------------------------------------------------------------------\n`;
    out += `RANK  ENTRY POINT             TIER        COST   CPU  MEM  STOR  CALLS\n`;
    out += `--------------------------------------------------------------------------------\n`;

    for (const ep of filteredProfiles) {
      const rankStr = String(ep.rank).padEnd(5);
      const nameStr = (ep.name + '()').padEnd(23).slice(0, 23);
      const tierStr = ep.costTier.toUpperCase().padEnd(11);
      const costStr = (String(ep.totalEstimatedCost) + '/100').padEnd(6);
      const cpuStr = String(ep.cpu.score).padEnd(4);
      const memStr = String(ep.memory.score).padEnd(4);
      const storStr = String(ep.storage.score).padEnd(5);
      const callStr = String(ep.contractCalls.score);

      out += `${rankStr} ${nameStr} ${tierStr} ${costStr} ${cpuStr} ${memStr} ${storStr} ${callStr}\n`;
    }

    out += `================================================================================\n`;
    return out;
  }

  /**
   * Filter and limit ranked profiles based on options.
   */
  private filterProfiles(profiles: EntryPointProfile[], options: ProfileReportOptions): EntryPointProfile[] {
    let result = [...profiles];

    if (options.minCostTier) {
      const minLevel = TIER_ORDER[options.minCostTier];
      result = result.filter((p) => TIER_ORDER[p.costTier] >= minLevel);
    }

    if (options.topExpensiveLimit && options.topExpensiveLimit > 0) {
      result = result.slice(0, options.topExpensiveLimit);
    }

    return result;
  }
}

/**
 * Convenient standalone report generator function.
 */
export function generateProfileReport(
  report: EntryPointProfileReport,
  options?: ProfileReportOptions,
): string {
  const reporter = new SorobanProfileReporter();
  return reporter.generate(report, options);
}
