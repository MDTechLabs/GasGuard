import * as fs from 'fs';
import * as path from 'path';
import { Finding } from '@engine/core';
import { stellarKB } from '../../../knowledge-base/stellar/kb';
import { Evidence, EvidenceGeneratorOptions, CodeSnippet } from './types';

export class SorobanEvidenceGenerator {
  private fileCache: Map<string, string[]> = new Map();
  private options: Required<EvidenceGeneratorOptions>;

  constructor(options?: EvidenceGeneratorOptions) {
    this.options = {
      contextLines: options?.contextLines ?? 2,
    };
  }

  /**
   * Extracts a code snippet from a file, adding context lines.
   * Uses an internal cache to prevent redundant disk reads for the same file.
   */
  public extractCodeSnippet(filePath: string, startLine: number, endLine: number): CodeSnippet | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    let lines = this.fileCache.get(filePath);
    if (!lines) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        lines = content.split('\n');
        this.fileCache.set(filePath, lines);
      } catch (error) {
        // Fallback for permissions or unreadable files
        return null;
      }
    }

    // Convert 1-based line numbers to 0-based index
    const contextLines = this.options.contextLines;
    const extractStart = Math.max(0, startLine - 1 - contextLines);
    const extractEnd = Math.min(lines.length, endLine + contextLines);

    const extractedLines = lines.slice(extractStart, extractEnd);

    return {
      filePath,
      startLine: extractStart + 1, // Convert back to 1-based
      endLine: extractEnd,
      content: extractedLines.join('\n'),
    };
  }

  /**
   * Generates supporting evidence for a single finding.
   */
  public generateForFinding(finding: Finding): Evidence {
    const rule = stellarKB.getRule(finding.ruleId);
    
    let codeSnippet: CodeSnippet | null = null;
    if (finding.location && finding.location.file) {
      codeSnippet = this.extractCodeSnippet(
        finding.location.file,
        finding.location.startLine,
        finding.location.endLine
      );
    }

    return {
      ruleId: finding.ruleId,
      severity: finding.severity,
      description: rule ? rule.description : finding.message,
      explanation: rule ? rule.explanation : 'No detailed explanation available.',
      codeSnippet,
      documentationUrl: rule?.documentationUrl,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generates evidence for an array of findings.
   */
  public generateEvidence(findings: Finding[]): Evidence[] {
    return findings.map((finding) => this.generateForFinding(finding));
  }

  /**
   * Generates evidence and exports it as a JSON artifact.
   */
  public generateAndExportEvidence(findings: Finding[], outputPath: string): Evidence[] {
    const evidence = this.generateEvidence(findings);
    
    // Ensure the output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8');
    return evidence;
  }
}
