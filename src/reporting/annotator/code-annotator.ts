/**
 * Inline Code Annotation Output (#236)
 * Annotates source code lines with detected issues as inline comments.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Annotation {
  line: number;   // 1-based
  message: string;
  severity?: 'error' | 'warning' | 'info';
}

export interface AnnotationResult {
  filePath: string;
  annotatedContent: string;
}

/**
 * Insert inline comments into source code at the specified lines.
 */
export function annotateSource(
  source: string,
  annotations: Annotation[],
  commentPrefix = '//',
): string {
  const lines = source.split('\n');
  // Sort descending so inserting doesn't shift subsequent line numbers
  const sorted = [...annotations].sort((a, b) => b.line - a.line);

  for (const ann of sorted) {
    const idx = ann.line - 1;
    if (idx < 0 || idx >= lines.length) continue;
    const tag = ann.severity ? `[${ann.severity.toUpperCase()}]` : '[NOTE]';
    lines.splice(idx, 0, `${commentPrefix} GasGuard ${tag}: ${ann.message}`);
  }

  return lines.join('\n');
}

/**
 * Annotate a file on disk and write the result to an output path.
 */
export function annotateFile(
  filePath: string,
  annotations: Annotation[],
  outputPath?: string,
): AnnotationResult {
  const source = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath);
  const commentPrefix = ext === '.rs' ? '//' : ext === '.vy' ? '#' : '//';
  const annotatedContent = annotateSource(source, annotations, commentPrefix);

  const dest = outputPath ?? filePath + '.annotated';
  fs.writeFileSync(dest, annotatedContent, 'utf8');

  return { filePath: dest, annotatedContent };
}
