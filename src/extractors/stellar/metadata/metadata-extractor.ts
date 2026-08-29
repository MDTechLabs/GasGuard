import {
  ContractMetadata,
  FunctionMetadata,
  MetadataExtractorConfig,
  MetadataSummary,
  ParameterMetadata,
  StorageMetadata,
} from './types';

export class StellarMetadataExtractor {
  private source: string;
  private filePath: string;
  private config: MetadataExtractorConfig;

  constructor(
    source: string,
    filePath: string,
    config: MetadataExtractorConfig = { inferDescriptions: true, includePrivateFunctions: true },
  ) {
    this.source = source;
    this.filePath = filePath;
    this.config = config;
  }

  extract(): ContractMetadata {
    const name = this.extractContractName();
    const functions = this.extractFunctions();
    const storage = this.extractStorage();
    const traits = this.extractTraits();
    const events = this.extractEvents();
    const dependencies = this.extractDependencies();

    return {
      name,
      description: this.inferDescription(name, functions, traits),
      version: this.extractVersion(),
      traits,
      functions,
      storage,
      events,
      dependencies,
      complexity: {
        totalFunctions: functions.length,
        totalTraits: traits.length,
        totalEvents: events.length,
        totalStorageKeys: storage.length,
        score: functions.length + traits.length * 2 + storage.length,
      },
    };
  }

  summarize(): MetadataSummary {
    const metadata = this.extract();
    const insights: string[] = [];

    if (metadata.functions.length > 10) {
      insights.push(`Contract has ${metadata.functions.length} functions, consider splitting into smaller contracts.`);
    }

    if (metadata.traits.length > 3) {
      insights.push(`Uses ${metadata.traits.length} traits, verify inheritance depth is manageable.`);
    }

    if (metadata.storage.length > 5) {
      insights.push(`High storage key count (${metadata.storage.length}). Review for potential state bloat.`);
    }

    if (metadata.dependencies.length > 5) {
      insights.push(`${metadata.dependencies.length} dependencies detected. Audit for supply chain risks.`);
    }

    const authFunctions = metadata.functions.filter(f => f.hasAuth);
    if (authFunctions.length > 0) {
      insights.push(`${authFunctions.length} function(s) require authorization.`);
    }

    if (insights.length === 0) {
      insights.push('Contract appears well-structured with manageable complexity.');
    }

    return {
      contractName: metadata.name,
      totalFunctions: metadata.complexity.totalFunctions,
      totalTraits: metadata.complexity.totalTraits,
      storageKeys: metadata.complexity.totalStorageKeys,
      dependencies: metadata.dependencies.join(', ') || 'none',
      keyInsights: insights,
    };
  }

  private extractContractName(): string {
    const match = this.source.match(/pub struct (\w+)/)
      || this.source.match(/#\[contract\]\s*\n.*?pub\s+(?:struct|fn)\s+(\w+)/)
      || this.source.match(/contract\s+(\w+)/);
    return match ? match[1] : 'UnknownContract';
  }

  private extractFunctions(): FunctionMetadata[] {
    const functions: FunctionMetadata[] = [];
    const fnRegex = /(pub\s+)?fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^{]+))?/g;
    let match;

    while ((match = fnRegex.exec(this.source)) !== null) {
      const isPublic = match[1]?.includes('pub') ?? false;
      if (!this.config.includePrivateFunctions && !isPublic) continue;

      const params = this.parseParameters(match[3]);
      const bodyStart = this.source.indexOf('{', match.index);
      const body = bodyStart > 0 ? this.source.substring(bodyStart, this.source.indexOf('}', bodyStart) + 1) : '';

      functions.push({
        name: match[2],
        visibility: isPublic ? 'public' : 'private',
        parameters: params,
        returnType: match[4]?.trim() || '()',
        hasAuth: body.includes('require_auth') || body.includes('.require_auth()'),
        line: this.getLineNumber(match.index),
      });
    }

    return functions;
  }

  private parseParameters(paramsStr: string): ParameterMetadata[] {
    if (!paramsStr || paramsStr.trim() === 'env: Env') return [];

    return paramsStr
      .split(',')
      .map(p => p.trim())
      .filter(p => p && !p.startsWith('env:'))
      .map(p => {
        const parts = p.split(':').map(s => s.trim());
        const name = parts[0] || '';
        const type = parts.slice(1).join(':') || 'unknown';
        return {
          name,
          type,
          isAddress: type === 'Address',
        };
      });
  }

  private extractStorage(): StorageMetadata[] {
    const storage: StorageMetadata[] = [];

    const storageRegex = /env\.storage\(\)\.(instance|persistent|temporary)\(\)\.(get|set|has)\(&([^,)]+)/g;
    let match;

    while ((match = storageRegex.exec(this.source)) !== null) {
      const key = match[3].replace(/"/g, '').trim();
      const existing = storage.find(s => s.key === key);

      if (!existing) {
        storage.push({
          key,
          type: 'unknown',
          persistence: match[1] as StorageMetadata['persistence'],
          access: match[2] === 'get' ? 'read' : 'write',
        });
      } else if (existing.access === 'read' && match[2] === 'set') {
        existing.access = 'read-write';
      }
    }

    return storage;
  }

  private extractTraits(): string[] {
    const traits: string[] = [];
    const traitRegex = /trait\s+(\w+)/g;
    let match;
    while ((match = traitRegex.exec(this.source)) !== null) {
      traits.push(match[1]);
    }
    return traits;
  }

  private extractEvents(): string[] {
    const events: string[] = [];
    const eventRegex = /env\.events\(\)\.(publish|emit)\(/g;
    let match;
    while ((match = eventRegex.exec(this.source)) !== null) {
      events.push(match[0]);
    }
    return [...new Set(events)];
  }

  private extractDependencies(): string[] {
    const deps: string[] = [];
    const useRegex = /use\s+([\w:]+)/g;
    let match;
    while ((match = useRegex.exec(this.source)) !== null) {
      const dep = match[1].split('::')[0];
      if (dep !== 'soroban_sdk' && !deps.includes(dep)) deps.push(dep);
    }
    return deps;
  }

  private extractVersion(): string {
    const match = this.source.match(/version\s*=\s*"(\d+\.\d+\.\d+)"/)
      || this.source.match(/##\s*\[?(\d+\.\d+\.\d+)\]?/);
    return match ? match[1] : '0.0.0';
  }

  private inferDescription(name: string, functions: FunctionMetadata[], traits: string[]): string {
    if (!this.config.inferDescriptions) return '';

    const fnNames = functions.map(f => f.name);
    const hasTransfer = fnNames.some(n => n.includes('transfer'));
    const hasBalance = fnNames.some(n => n.includes('balance'));
    const hasInit = fnNames.some(n => n.includes('init') || n.includes('new') || n.includes('create'));

    const parts: string[] = [`Soroban contract "${name}"`];
    if (hasTransfer && hasBalance) parts.push('implements token operations including transfers and balance queries');
    else if (hasInit) parts.push('provides initialization and core contract functionality');
    else parts.push('exposes contract operations');

    if (traits.length > 0) parts.push(`using ${traits.length} trait(s)`);

    return parts.join(', ') + '.';
  }

  private getLineNumber(offset: number): number {
    return (this.source.substring(0, offset).match(/\n/g) || []).length + 1;
  }
}
