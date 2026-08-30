import { Injectable, Logger } from '@nestjs/common';
import { ASTNode, ContractDefinition } from '@gasguard/parser';

export interface RedundantReadFinding {
  ruleId: string;
  severity: 'medium' | 'low';
  message: string;
  nodeId?: string;
  recommendation: string;
}

export interface RedundantReadAnalysisResult {
  contractPath: string;
  findings: RedundantReadFinding[];
  metrics: {
    redundantReadsDetected: number;
  };
}

@Injectable()
export class SorobanRedundantReadAnalyzer {
  private readonly logger = new Logger(SorobanRedundantReadAnalyzer.name);

  public analyze(contractAst: ContractDefinition, contractPath: string): RedundantReadAnalysisResult {
    this.logger.debug(`Analyzing redundant storage reads for contract: ${contractPath}`);

    const findings: RedundantReadFinding[] = [];
    let redundantReadsDetected = 0;

    this.traverseFunctions(contractAst, (functionNode) => {
      const readKeys = new Set<string>();

      this.traverseAst(functionNode, (node) => {
        if (this.isStorageRead(node)) {
          const key = this.extractStorageKey(node);
          if (key) {
            if (readKeys.has(key)) {
              redundantReadsDetected++;
              findings.push({
                ruleId: 'SOROBAN-STOR-04',
                severity: 'medium',
                message: `Redundant storage read detected for key '${key}'.`,
                nodeId: node.id,
                recommendation: 'Cache the storage query result in a local variable instead of reading it multiple times.',
              });
            } else {
              readKeys.add(key);
            }
          }
        }

        if (this.isStorageWrite(node)) {
          const key = this.extractStorageKey(node);
          if (key) {
            readKeys.delete(key);
          }
        }
      });
    });

    return {
      contractPath,
      findings,
      metrics: {
        redundantReadsDetected,
      },
    };
  }

  private traverseFunctions(node: ASTNode, callback: (node: ASTNode) => void): void {
    if (node.type === 'FunctionDefinition' || node.type === 'MethodDefinition') {
      callback(node);
    }
    if (node.children) {
      for (const child of node.children) {
        this.traverseFunctions(child, callback);
      }
    }
  }

  private traverseAst(node: ASTNode, callback: (node: ASTNode) => void): void {
    callback(node);
    if (node.children) {
      for (const child of node.children) {
        this.traverseAst(child, callback);
      }
    }
  }

  private isStorageRead(node: ASTNode): boolean {
    return node.type === 'MethodCall' && (node.value === 'get' || node.value === 'has');
  }

  private isStorageWrite(node: ASTNode): boolean {
    return node.type === 'MethodCall' && (node.value === 'set' || node.value === 'put');
  }

  private extractStorageKey(node: ASTNode): string | null {
    return node.metadata?.['storageKey'] ?? node.arguments?.[0]?.value ?? null;
  }
}