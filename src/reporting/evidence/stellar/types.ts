import { Finding } from '@engine/core';

export interface CodeSnippet {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface Evidence {
  findingId?: string; // Optional unique identifier for the finding instance
  ruleId: string;
  severity: string;
  description: string;
  explanation: string;
  codeSnippet: CodeSnippet | null;
  documentationUrl?: string;
  generatedAt: string;
}

export interface EvidenceGeneratorOptions {
  /**
   * Number of lines to include before and after the finding for context.
   * Default is usually 2.
   */
  contextLines?: number;
}
