import { Injectable, Logger } from '@nestjs/common';
import { ASTNode, ContractDefinition } from '@gasguard/parser';

export interface StorageLifetimeFinding {
  ruleId: string;
  severity: 'medium' | 'low';
  message: string;
  nodeId?: string;
  recommendation: string;
}

export interface StorageLifetimeAnalysisResult {
  contractPath: string;
  findings: StorageLifetimeFinding[];
  metrics: {
    temporaryStorageCandidates: number;
    persistentStorageEntries: number;
  };
}

@Injectable()
export class SorobanStorageLifetimeAnalyzer {
  private readonly logger = new Logger(SorobanStorageLifetimeAnalyzer.name);

  public analyze(contractAst: ContractDefinition, contractPath: string): StorageLifetimeAnalysisResult {
    this.logger.debug(`Analyzing storage lifetimes for contract: ${contractPath}`);

    const findings: StorageLifetimeFinding[] = [];
    let temporaryStorageCandidates = 0;
    let persistentStorageEntries = 0;

    this.traverseAst(contractAst, (node) => {
      if (this.isPersistentStorageDeclaration(node)) {
        persistentStorageEntries++;

        if (this.isShortLivedDataPattern(node)) {
          temporaryStorageCandidates++;
          findings.push({
            ruleId: 'SOROBAN-STOR-06',
            severity: 'medium',
            message: 'Persistent storage used for data with short-lived or transient lifecycle characteristics.',
            nodeId: node.id,
            recommendation: 'Use temporary storage or instance storage with appropriate TTL extension instead of persistent storage for ephemeral data.',
          });
        }
      }
    });

    return {
      contractPath,
      findings,
      metrics: {
        temporaryStorageCandidates,
        persistentStorageEntries,
      },
    };
  }

  private traverseAst(node: ASTNode, callback: (node: ASTNode) => void): void {
    callback(node);
    if (node.children) {
      for (const child of node.children) {
        this.traverseAst(child, callback);
      }
    }
  }

  private isPersistentStorageDeclaration(node: ASTNode): boolean {
    return node.type === 'StorageDefinition' && node.metadata?.['storageType'] === 'persistent';
  }

  private isShortLivedDataPattern(node: ASTNode): boolean {
    const usageContext = node.metadata?.['usageContext'] ?? '';
    return usageContext === 'nonce' || usageContext === 'temp_cache' || usageContext === 'session_token';
  }
}