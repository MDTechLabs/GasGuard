export interface SimilarityResult {
  score: number;
  isNearDuplicate: boolean;
}

export class SimilarityEngine {
  /**
   * Compares contract structures and generates similarity scores.
   * Detects near-duplicates based on a threshold.
   */
  compare(contractA: string, contractB: string): SimilarityResult {
    // Simple tokenization by whitespace and non-alphanumeric chars
    const tokensA = new Set(contractA.split(/[\s\W]+/).filter(t => t.length > 0));
    const tokensB = new Set(contractB.split(/[\s\W]+/).filter(t => t.length > 0));
    
    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) {
        intersection++;
      }
    }
    
    const union = tokensA.size + tokensB.size - intersection;
    const score = union === 0 ? 1 : intersection / union;
    
    return {
      score,
      isNearDuplicate: score > 0.85
    };
  }
  
  detectNearDuplicates(contracts: Record<string, string>): Array<[string, string]> {
    const duplicates: Array<[string, string]> = [];
    const keys = Object.keys(contracts);
    
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const result = this.compare(contracts[keys[i]], contracts[keys[j]]);
        if (result.isNearDuplicate) {
          duplicates.push([keys[i], keys[j]]);
        }
      }
    }
    
    return duplicates;
  }
}
