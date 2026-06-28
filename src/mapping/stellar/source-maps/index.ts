export interface SourceLocation {
  line: number;
  column: number;
  file?: string;
}

export interface Finding {
  id: string;
  description: string;
  location?: SourceLocation;
}

export class SourceMappingEngine {
  private sourceMap = new Map<string, SourceLocation>();
  private findings = new Map<string, Finding>();

  /**
   * Resolves source locations from AST nodes or elements.
   */
  resolveLocation(nodeId: string, line: number, column: number, file?: string): SourceLocation {
    const loc = { line, column, file };
    this.sourceMap.set(nodeId, loc);
    return loc;
  }

  /**
   * Links findings directly to code coordinates.
   */
  linkFinding(finding: Finding, nodeId: string): Finding {
    const loc = this.sourceMap.get(nodeId);
    if (loc) {
      finding.location = loc;
    }
    this.findings.set(finding.id, finding);
    return finding;
  }
  
  getFinding(findingId: string): Finding | undefined {
    return this.findings.get(findingId);
  }
}
