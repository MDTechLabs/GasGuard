/**
 * Issue #779 — Detect Redundant Soroban Event Emissions
 *
 * Identifies duplicate event emissions within the same function scope.
 * Repeated events with identical topics and payloads waste transaction resources.
 */

export interface EventEmission {
  /** Line number of the emission */
  line: number;
  /** Raw event expression as it appears in source */
  expression: string;
  /** Parsed event name / topic */
  topic: string;
  /** Parsed payload arguments (stringified) */
  payload: string;
}

export interface RedundantEventWarning {
  line: number;
  topic: string;
  duplicateLines: number[];
  message: string;
  suggestion: string;
}

/**
 * Detects duplicate `env.events().publish(...)` calls in Soroban contracts.
 *
 * Two emissions are considered redundant when they share the same topic tuple
 * and the same data payload within the same function body.
 */
export class RedundantEventEmissionsRule {
  public static readonly RULE_ID = 'soroban-redundant-event-emissions';

  /** Regex matching `env.events().publish((topic...), payload)` */
  private static readonly PUBLISH_PATTERN =
    /env\.events\(\)\.publish\s*\(\s*(\([^)]*\))\s*,\s*([^)]+)\)/g;

  public analyze(sourceCode: string): RedundantEventWarning[] {
    const warnings: RedundantEventWarning[] = [];
    const lines = sourceCode.split('\n');

    // Split source into function bodies so we don't flag cross-function duplicates
    const functionBlocks = this.extractFunctionBlocks(sourceCode, lines);

    for (const block of functionBlocks) {
      const emissions = this.collectEmissions(block.source, block.lineOffset);
      const duplicates = this.findDuplicates(emissions);

      for (const [topic, group] of duplicates) {
        // The first occurrence is the canonical one; the rest are redundant
        const [first, ...rest] = group;
        warnings.push({
          line: first.line,
          topic,
          duplicateLines: rest.map((e) => e.line),
          message: `Event '${topic}' is emitted ${group.length} times with identical payload in the same function.`,
          suggestion:
            `Consolidate duplicate emissions of '${topic}' into a single publish call ` +
            `to reduce transaction event overhead.`,
        });
      }
    }

    return warnings;
  }

  // ── private helpers ─────────────────────────────────────────────────────────

  /**
   * Splits source into per-function blocks using a simple brace-counting heuristic.
   */
  private extractFunctionBlocks(
    source: string,
    lines: string[],
  ): Array<{ source: string; lineOffset: number }> {
    const blocks: Array<{ source: string; lineOffset: number }> = [];
    // Match `fn <name>(...) { ... }` patterns
    const fnHeaderRe = /\bfn\s+\w+\s*\([^)]*\)[^{]*\{/g;
    let match: RegExpExecArray | null;

    while ((match = fnHeaderRe.exec(source)) !== null) {
      const start = match.index + match[0].length - 1; // position of opening '{'
      const body = this.extractBraceBlock(source, start);
      if (body === null) continue;

      const lineOffset = source.slice(0, start).split('\n').length - 1;
      blocks.push({ source: body, lineOffset });
    }

    // If no functions found, treat the whole file as one block
    if (blocks.length === 0) {
      blocks.push({ source, lineOffset: 0 });
    }

    return blocks;
  }

  /** Extracts the content between the matched braces starting at `openPos`. */
  private extractBraceBlock(source: string, openPos: number): string | null {
    let depth = 0;
    let i = openPos;
    while (i < source.length) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) return source.slice(openPos, i + 1);
      }
      i++;
    }
    return null;
  }

  /** Collects all publish() calls in a block with their adjusted line numbers. */
  private collectEmissions(blockSource: string, lineOffset: number): EventEmission[] {
    const emissions: EventEmission[] = [];
    const pattern = new RegExp(RedundantEventEmissionsRule.PUBLISH_PATTERN.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(blockSource)) !== null) {
      const lineInBlock = blockSource.slice(0, match.index).split('\n').length - 1;
      const topic = match[1].replace(/\s+/g, '');
      const payload = match[2].trim();

      emissions.push({
        line: lineOffset + lineInBlock + 1,
        expression: match[0],
        topic,
        payload,
      });
    }

    return emissions;
  }

  /**
   * Groups emissions by `topic + payload` and returns only groups with > 1 entry.
   */
  private findDuplicates(
    emissions: EventEmission[],
  ): Map<string, EventEmission[]> {
    const grouped = new Map<string, EventEmission[]>();

    for (const emission of emissions) {
      const key = `${emission.topic}::${emission.payload}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(emission);
    }

    const duplicates = new Map<string, EventEmission[]>();
    for (const [key, group] of grouped) {
      if (group.length > 1) {
        const topic = key.split('::')[0];
        duplicates.set(topic, group);
      }
    }

    return duplicates;
  }
}
