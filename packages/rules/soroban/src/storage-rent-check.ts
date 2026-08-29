export interface StorageRentWarning {
  line: number;
  column?: number;
  storageType: 'persistent' | 'temporary' | 'instance';
  key?: string;
  message: string;
  suggestion: string;
  estimatedRentSavings?: string;
}

export class SorobanStorageRentCheckRule {
  public static readonly RULE_ID = 'soroban-storage-rent';

  public analyze(sourceCode: string): StorageRentWarning[] {
    const warnings: StorageRentWarning[] = [];
    const lines = sourceCode.split('\n');

    const ephemeralKeywords = ['nonce', 'counter', 'session', 'temp', 'ephemeral', 'cache'];

    let hasInstanceStorageAccess = false;
    let hasExtendTtlCall = false;
    let instanceLineIndex = -1;

    const variableSymbolMap = new Map<string, string>();
    for (const l of lines) {
      const symMatch = l.match(/let\s+([a-zA-Z0-9_]+)\s*=\s*Symbol::new\(&env,\s*"([^"]+)"\)/);
      if (symMatch) {
        variableSymbolMap.set(symMatch[1], symMatch[2]);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('env.storage().persistent()')) {
        const lowerLine = line.toLowerCase();
        const lowerFull = sourceCode.toLowerCase();
        
        let isEphemeral = false;
        for (const kw of ephemeralKeywords) {
          if (lowerLine.includes(kw) || lowerFull.includes(kw)) {
            isEphemeral = true;
            break;
          }
        }

        if (isEphemeral) {
          let detectedKey = 'ephemeral_key';
          const inlineMatch = line.match(/Symbol::new\(&env,\s*"([^"]+)"\)/);
          const refMatch = line.match(/&([a-zA-Z0-9_]+)/);

          if (inlineMatch && inlineMatch[1]) {
            detectedKey = inlineMatch[1];
          } else if (refMatch && refMatch[1]) {
            const varName = refMatch[1];
            if (variableSymbolMap.has(varName)) {
              detectedKey = variableSymbolMap.get(varName)!;
            } else {
              detectedKey = varName;
            }
          }

          warnings.push({
            line: i + 1,
            storageType: 'persistent',
            key: detectedKey,
            message: `Ephemeral state entry '${detectedKey}' is stored in Persistent storage instead of Temporary storage.`,
            suggestion: `Replace env.storage().persistent() with env.storage().temporary() for key '${detectedKey}'.`,
            estimatedRentSavings: '~80% ledger rent fee reduction for short-lived state',
          });
        }
      }

      if (line.includes('env.storage().instance()')) {
        hasInstanceStorageAccess = true;
        if (instanceLineIndex === -1) {
          instanceLineIndex = i + 1;
        }
      }

      if (line.includes('extend_ttl') || line.includes('.extend_ttl(')) {
        hasExtendTtlCall = true;
      }
    }

    if (hasInstanceStorageAccess && !hasExtendTtlCall) {
      warnings.push({
        line: instanceLineIndex > 0 ? instanceLineIndex : 1,
        storageType: 'instance',
        message: 'Soroban instance storage modified or accessed without explicit extend_ttl call.',
        suggestion: 'Call env.storage().instance().extend_ttl(threshold, extend_to) to prevent contract state archival.',
        estimatedRentSavings: 'Prevents state archival restore fees',
      });
    }

    return warnings;
  }
}
