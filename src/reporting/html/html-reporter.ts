/**
 * HTML Reporter
 * 
 * Generates human-readable HTML reports from analysis results.
 */

import { ReportData } from './types';
import { getReportTemplate } from './template';
import * as fs from 'fs';
import * as path from 'path';

export class HtmlReporter {
  /**
   * Generate an HTML report string
   */
  generate(data: ReportData): string {
    return getReportTemplate(data);
  }

  /**
   * Save the report to a file
   */
  async saveReport(data: ReportData, outputPath: string): Promise<string> {
    const html = this.generate(data);
    
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, html, 'utf8');
    return outputPath;
  }

  /**
   * Create report data from raw results
   */
  createReportData(
    projectName: string,
    version: string,
    issues: any[],
    totalFiles: number,
    durationMs: number
  ): ReportData {
    return {
      projectName,
      version,
      metrics: {
        totalFiles,
        totalIssues: issues.length,
        criticalIssues: issues.filter(i => i.confidence > 0.9).length,
        highIssues: issues.filter(i => i.confidence > 0.7 && i.confidence <= 0.9).length,
        mediumIssues: issues.filter(i => i.confidence > 0.5 && i.confidence <= 0.7).length,
        lowIssues: issues.filter(i => i.confidence <= 0.5).length,
        scannedAt: new Date(),
        durationMs
      },
      issues
    };
  }
}
