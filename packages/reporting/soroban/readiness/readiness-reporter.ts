/**
 * Soroban Deployment Readiness Reporter
 *
 * Formats a deployment readiness assessment (see
 * `analyzers/soroban/readiness/deployment-readiness-analyzer`) into human and
 * machine readable output, so the pass/fail decision can be surfaced in the
 * CLI, a report file, or a pull-request comment.
 */
import {
  ReadinessResult,
  ReadinessCheck,
} from '../../../analyzers/soroban/readiness/deployment-readiness-analyzer';

const STATUS_EMOJI: Record<ReadinessCheck['status'], string> = {
  pass: '✅',
  fail: '❌',
  warn: '⚠️',
};

/**
 * Render the readiness result as formatted Markdown.
 */
export function renderReadinessMarkdown(result: ReadinessResult): string {
  const lines: string[] = [];
  lines.push(`# Soroban Deployment Readiness Report`);
  if (result.model) lines.push(`\n**Contract model:** \`${result.model}\``);
  lines.push(`\n**Status:** ${STATUS_EMOJI[result.status]} \`${result.status.toUpperCase()}\``);
  lines.push('');
  lines.push(result.summary);
  lines.push('');
  lines.push(`**Checks:** ${result.passedChecks}/${result.totalChecks} passed${result.failedChecks > 0 ? `, ${result.failedChecks} failed` : ''} · ${result.criticalFindings} critical finding(s)`);
  lines.push('');
  lines.push('| Check | Status | Details |');
  lines.push('| --- | --- | --- |');
  for (const check of result.checks) {
    const detail = check.messages.join('<br/>');
    lines.push(`| ${check.name} | ${STATUS_EMOJI[check.status]} ${check.status} | ${detail} |`);
  }
  return lines.join('\n');
}

/**
 * Serialize the readiness result compactly as JSON.
 */
export function renderReadinessJson(result: ReadinessResult): string {
  return JSON.stringify(
    {
      status: result.status,
      model: result.model,
      summary: result.summary,
      passedChecks: result.passedChecks,
      totalChecks: result.totalChecks,
      failedChecks: result.failedChecks,
      criticalFindings: result.criticalFindings,
      checks: result.checks,
    },
    null,
    2,
  );
}