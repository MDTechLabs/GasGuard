import { Injectable, Logger } from '@nestjs/common';
import { ASTNode, ContractDefinition } from '@gasguard/parser';

export interface RedundantWriteFinding {
  ruleId: string;
  severity: 'medium' | 'low';
  message: string;
  nodeId?: string;
  recommendation: string;
}

export interface RedundantWriteAnalysisResult {
  contractPath: string;
  findings: RedundantWriteFinding[];
  metrics: {
    redundantWritesDetected: number;
  };
}

@Injectable()
export class SorobanRedundantWriteAnalyzer {
  private readonly logger = new Logger(SorobanRedundantWriteAnalyzer.name);

  public analyze(contractAst: ContractDefinition, contractPath: string): RedundantWriteAnalysisResult {
    this.logger.debug(`Analyzing redundant storage writes for contract: ${contractPath}`);

    const findings: RedundantWriteFinding[] = [];
    let redundantWritesDetected = 0;

    this.traverseFunctions(contractAst, (functionNode) => {
      const writtenValues = new Map<string, string>(); // key -> value expression/literal representation

      this.traverseAst(functionNode, (node) => {
        if (this.isStorageWrite(node)) {
          const key = this.extractStorageKey(node);
          const value = this.extractStorageValue(node);

          if (key) {
            if (writtenValues.has(key) && writtenValues.get(key) === value) {
              redundantWritesDetected++;
              findings.push({
                ruleId: 'SOROBAN-STOR-05',
                severity: 'medium',
                message: `Redundant identical storage write detected for key '${key}' with value '${value}'.`,
                nodeId: node.id,
                recommendation: 'Check if the state has already been updated or skip duplicate write operations to save transaction fees.',
              });
            } else if (value !== null) {
              writtenValues.set(key, value);
            }
          }
        }
      });
    });

    return {
      contractPath,
      findings,
      metrics: {
        redundantWritesDetected,
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

  private isStorageWrite(node: ASTNode): boolean {
    return node.type === 'MethodCall' && (node.value === 'set' || node.value === 'put');
  }

  private extractStorageKey(node: ASTNode): string | null {
    return node.metadata?.['storageKey'] ?? node.arguments?.[0]?.value ?? null;
  }

  private extractStorageValue(node: ASTNode): string | null {
    return node.metadata?.['storageValue'] ?? node.arguments?.[1]?.value ?? null;
  }
}
