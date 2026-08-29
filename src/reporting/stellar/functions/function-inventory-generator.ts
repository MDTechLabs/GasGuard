import { ContractFunction, FunctionInventory, FunctionInventoryConfig, FunctionVisibility } from './types';

const DEFAULT_CONFIG: Required<FunctionInventoryConfig> = {
  includePrivate: true,
};

export class SorobanFunctionInventoryGenerator {
  private config: Required<FunctionInventoryConfig>;

  constructor(config?: Partial<FunctionInventoryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  generate(source: string, filePath: string): FunctionInventory {
    const contractName = this.extractContractName(source);
    const functions = this.extractFunctions(source);
    const visible = this.config.includePrivate
      ? functions
      : functions.filter((f) => f.visibility !== 'private');

    return {
      contractName,
      filePath,
      functions: visible,
      publicCount: visible.filter((f) => f.visibility === 'public').length,
      privateCount: visible.filter((f) => f.visibility === 'private').length,
      internalCount: visible.filter((f) => f.visibility === 'internal').length,
      totalCount: visible.length,
      generatedAt: new Date(),
    };
  }

  private extractContractName(source: string): string {
    const match = source.match(/(?:impl|struct)\s+(\w+)/);
    return match?.[1] ?? 'UnknownContract';
  }

  private extractFunctions(source: string): ContractFunction[] {
    const functions: ContractFunction[] = [];
    const lines = source.split('\n');

    // Match Soroban/Rust fn signatures
    const fnRegex = /^\s*(pub(?:\(crate\))?|)?\s*fn\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^{;]+))?/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(fnRegex);
      if (!match) continue;

      const [, vis, name, params, ret] = match;
      const visibility = this.resolveVisibility(vis?.trim() ?? '');
      const isConstructor = name === 'new' || name === 'init' || name === 'initialize';

      functions.push({
        name,
        visibility,
        params: this.parseParams(params),
        returnType: ret?.trim() ?? null,
        isConstructor,
        lineNumber: i + 1,
      });
    }

    return functions;
  }

  private resolveVisibility(vis: string): FunctionVisibility {
    if (vis.startsWith('pub')) return 'public';
    if (vis === 'internal') return 'internal';
    return 'private';
  }

  private parseParams(raw: string): string[] {
    return raw
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p !== 'self' && p !== '&self' && p !== '&mut self');
  }
}
