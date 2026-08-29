export interface DocSummary {
  description: string;
  annotations: Record<string, string>;
  methods: Record<string, string>;
}

export class DocumentationExtractor {
  /**
   * Parses comments and annotations from Soroban contract source code.
   * Generates documentation summaries and exports structured outputs.
   */
  extract(sourceCode: string): DocSummary {
    const annotations: Record<string, string> = {};
    const methods: Record<string, string> = {};
    
    // Simple parsing for rust doc comments (///)
    const lines = sourceCode.split('\n');
    let currentDoc: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('///')) {
        currentDoc.push(trimmed.substring(3).trim());
      } else if (trimmed.startsWith('#[')) {
        // Annotation
        const match = trimmed.match(/#\[(.*?)\]/);
        if (match) {
          annotations[match[1]] = currentDoc.join(' ');
          currentDoc = [];
        }
      } else if (trimmed.startsWith('pub fn')) {
        // Method
        const match = trimmed.match(/pub fn ([a-zA-Z0-9_]+)/);
        if (match) {
          methods[match[1]] = currentDoc.join(' ');
          currentDoc = [];
        }
      } else if (trimmed !== '') {
        currentDoc = [];
      }
    }

    return {
      description: "Extracted Soroban documentation",
      annotations,
      methods
    };
  }
}
