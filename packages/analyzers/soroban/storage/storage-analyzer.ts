import { Injectable, Logger } from '@nestjs/common';
import { ASTNode, ContractDefinition } from '@gasguard/parser'; // Example internal parser types

export interface StorageFinding {
  ruleId: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  nodeId?: string;
  recommendation: string;
}

export interface StorageAnalysisResult {
  contractPath: string;
  findings: StorageFinding[];
  metrics: {
    persistentEntriesCount: number;
    frequentWritesDetected: number;
    unnecessaryReadsDetected: number;
  };
}

@Injectable()
export class SorobanStorageAnalyzer {
  private readonly logger = new Logger(SorobanStorageAnalyzer.name);

  public analyze(contractAst: ContractDefinition, contractPath: string): StorageAnalysisResult {
    this.logger.debug(`Analyzing storage patterns for contract: ${contractPath}`);

    const findings: StorageFinding[] = [];
    let persistentEntriesCount = 0;
    let frequentWritesDetected = 0;
    let unnecessaryReadsDetected = 0;

    // Traverse AST nodes looking for Soroban Env storage interactions (env.storage().persistent(), instance(), temporary())
    this.traverseAst(contractAst, (node) => {
      if (this.isStorageWrite(node)) {
        frequentWritesDetected++;
        if (this.isInLoop(node)) {
          findings.push({
            ruleId: 'SOROBAN-STOR-01',
            severity: 'high',
            message: 'Frequent storage write detected inside a loop structure.',
            recommendation: 'Batch state modifications or aggregate values in memory before committing to persistent storage once.',
          });
        }
      }

      if (this.isStorageRead(node) && this.isRedundantRead(node)) {
        unnecessaryReadsDetected++;
        findings.push({
          ruleId: 'SOROBAN-STOR-02',
          severity: 'medium',
          message: 'Unnecessary redundant storage read identified.',
          recommendation: 'Cache storage query results in local variables or function scope instead of fetching multiple times.',
        });
      }

      if (this.isLargePersistentDeclaration(node)) {
        persistentEntriesCount++;
        findings.push({
          ruleId: 'SOROBAN-STOR-03',
          severity: 'medium',
          message: 'Large persistent entry schema declared without explicit TTL management.',
          recommendation: 'Ensure instance or temporary storage is used where permanent retention is unnecessary, or extend TTL dynamically.',
        });
      }
    });

    return {
      contractPath,
      findings,
      metrics: {
        persistentEntriesCount,
        frequentWritesDetected,
        unnecessaryReadsDetected,
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

  private isStorageWrite(node: ASTNode): boolean {
    return node.type === 'MethodCall' && (node.value === 'set' || node.value === 'تماد_set' || node.value === 'put');
  }

  private isStorageRead(node: ASTNode): boolean {
    return node.type === 'MethodCall' && (node.value === 'get' || node.value === 'has');
  }

  private isInLoop(node: ASTNode): boolean {
    let parent = node.parent;
    while (parent) {
      if (parent.type === 'ForStatement' || parent.type === 'WhileStatement' || parent.type === 'LoopExpression') {
        return true;
      }
      parent = parent.parent;
    }
    return false;
  }

  private isRedundantRead(node: ASTNode): boolean {
    // Heuristic placeholder for pattern matching repeated identical key lookups within same block scope
    return node.metadata?.['isRepeatedLookup'] === true;
  }

  private isLargePersistentDeclaration(node: ASTNode): boolean {
    return node.type === 'StorageDefinition' && node.metadata?.['storageType'] === 'persistent';
  }
}