export interface RuleMetadata {
  id: string;
  name: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

export class AutoRegistry {
  private rules = new Map<string, RuleMetadata>();

  /**
   * Automatically discovers rules from a given module or directory.
   */
  discover(modules: Record<string, any>): void {
    for (const [key, exported] of Object.entries(modules)) {
      if (exported && typeof exported === 'object' && 'metadata' in exported) {
        this.register(exported.metadata);
      }
    }
  }

  /**
   * Validates rule metadata to ensure it meets requirements.
   */
  validateMetadata(metadata: any): metadata is RuleMetadata {
    return (
      metadata &&
      typeof metadata.id === 'string' &&
      typeof metadata.name === 'string' &&
      typeof metadata.description === 'string' &&
      ['high', 'medium', 'low'].includes(metadata.severity)
    );
  }

  /**
   * Registers rules dynamically.
   */
  register(metadata: any): boolean {
    if (this.validateMetadata(metadata)) {
      this.rules.set(metadata.id, metadata);
      return true;
    }
    return false;
  }
  
  getRule(id: string): RuleMetadata | undefined {
    return this.rules.get(id);
  }
  
  getAllRules(): RuleMetadata[] {
    return Array.from(this.rules.values());
  }
}
