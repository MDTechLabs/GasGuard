import {
  Analyzer,
  BaseAnalyzer,
  Language,
  Rule,
  AnalysisResult,
  AnalyzerConfig,
  Finding,
  Severity,
} from '../core/analyzer-interface';

export class SolidityAnalyzer extends BaseAnalyzer implements Analyzer {
  private rules: Rule[] = [
    {
      id: 'sol-001',
      name: 'Inefficient Loop',
      description: 'Detects loops that could be optimized to reduce gas consumption',
      severity: Severity.HIGH,
      category: 'gas-optimization',
      enabled: true,
      tags: ['loops', 'gas', 'performance'],
      documentationUrl: 'https://docs.gasguard.dev/rules/sol-001',
      estimatedGasImpact: {
        min: 100,
        max: 5000,
        typical: 1000,
      },
    },
    {
      id: 'sol-002',
      name: 'Use of storage when memory would suffice',
      description: 'Detects unnecessary use of storage variables',
      severity: Severity.HIGH,
      category: 'gas-optimization',
      enabled: true,
      tags: ['storage', 'memory', 'gas'],
      documentationUrl: 'https://docs.gasguard.dev/rules/sol-002',
      estimatedGasImpact: {
        min: 2000,
        max: 20000,
        typical: 5000,
      },
    },
    {
      id: 'sol-003',
      name: 'Uncached array length in loop',
      description: 'Array length should be cached outside of loop to save gas',
      severity: Severity.MEDIUM,
      category: 'gas-optimization',
      enabled: true,
      tags: ['loops', 'arrays', 'gas'],
      documentationUrl: 'https://docs.gasguard.dev/rules/sol-003',
      estimatedGasImpact: {
        min: 50,
        max: 500,
        typical: 200,
      },
    },
    {
      id: 'sol-004',
      name: 'Use of ++ operator instead of ++i',
      description: 'Using ++i is more gas efficient than i++',
      severity: Severity.LOW,
      category: 'gas-optimization',
      enabled: true,
      tags: ['operators', 'gas'],
      documentationUrl: 'https://docs.gasguard.dev/rules/sol-004',
      estimatedGasImpact: {
        min: 5,
        max: 20,
        typical: 10,
      },
    },
    {
      id: 'sol-006',
      name: 'Missing Reentrancy Guard',
      description: 'Functions that transfer ETH or tokens should have reentrancy guards',
      severity: Severity.CRITICAL,
      category: 'security',
      enabled: true,
      tags: ['security', 'reentrancy', 'vulnerability'],
      documentationUrl: 'https://docs.gasguard.dev/rules/sol-006',
    },
    {
      id: 'sol-007',
      name: 'Insecure Fallback Function',
      description: 'Fallback/default handlers should reject unknown calls or enforce strict validation',
      severity: Severity.HIGH,
      category: 'security',
      enabled: true,
      tags: ['security', 'fallback', 'receive', 'validation'],
      documentationUrl: 'https://docs.gasguard.dev/rules/sol-007',
    },
    {
      id: 'sol-009',
      name: 'Missing Timelock For Sensitive Operations',
      description: 'Critical operations should be scheduled and executed only after a mandatory delay',
      severity: Severity.HIGH,
      category: 'security',
      enabled: true,
      tags: ['security', 'timelock', 'governance', 'delay', 'authorization'],
      documentationUrl: 'https://docs.gasguard.dev/rules/sol-009',
      id: 'sol-008',
      name: 'Unsafe External Call',
      description:
        'Detects external calls with unchecked return values, dangerous delegatecall usage, or Checks-Effects-Interactions (CEI) pattern violations',
      severity: Severity.HIGH,
      category: 'security',
      enabled: true,
      tags: ['security', 'external-calls', 'return-value', 'cei', 'delegatecall'],
      documentationUrl: 'https://docs.gasguard.dev/rules/sol-008',
    },
  ];
  
  getName(): string {
    return 'SolidityAnalyzer';
  }
  
  getVersion(): string {
    return '1.0.0';
  }
  
  supportsLanguage(language: Language | string): boolean {
    return language === Language.SOLIDITY || language === 'solidity' || language === 'sol';
  }
  
  getSupportedLanguages(): Language[] {
    return [Language.SOLIDITY];
  }
  
  getRules(): Rule[] {
    return this.rules;
  }
  
  async analyze(
    code: string,
    filePath: string,
    config?: AnalyzerConfig
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const findings: Finding[] = [];
    const errors: Array<{ file: string; message: string; error?: Error }> = [];
    
    // Ensure analyzer is initialized
    if (!this.initialized) {
      await this.initialize(config);
    }
    
    // Check if file should be analyzed
    if (!this.shouldAnalyzeFile(filePath, config)) {
      return {
        findings: [],
        filesAnalyzed: 0,
        analysisTime: Date.now() - startTime,
        analyzerVersion: this.getVersion(),
        summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      };
    }
    
    try {
      // Rule: sol-003 - Uncached array length in loop
      if (this.isRuleEnabled('sol-003', config)) {
        const uncachedArrayLoops = this.detectUncachedArrayLength(code);
        findings.push(...uncachedArrayLoops.map(location => ({
          ruleId: 'sol-003',
          message: 'Array length is not cached in loop. Cache it to save gas.',
          severity: this.getRuleSeverity('sol-003', config),
          location: {
            file: filePath,
            ...location,
          },
          estimatedGasSavings: 200,
          suggestedFix: {
            description: 'Cache array length in a local variable before the loop',
            codeSnippet: 'uint256 length = array.length;\nfor (uint256 i = 0; i < length; ++i) { ... }',
            documentationUrl: 'https://docs.gasguard.dev/rules/sol-003',
          },
        })));
      }
      
      // Rule: sol-004 - Use of i++ instead of ++i
      if (this.isRuleEnabled('sol-004', config)) {
        const inefficientIncrements = this.detectInefficientIncrements(code);
        findings.push(...inefficientIncrements.map(location => ({
          ruleId: 'sol-004',
          message: 'Use ++i instead of i++ to save gas',
          severity: this.getRuleSeverity('sol-004', config),
          location: {
            file: filePath,
            ...location,
          },
          estimatedGasSavings: 10,
          suggestedFix: {
            description: 'Replace i++ with ++i',
            codeSnippet: 'for (uint256 i = 0; i < length; ++i)',
            documentationUrl: 'https://docs.gasguard.dev/rules/sol-004',
          },
        })));
      }
      
      // Rule: sol-005 - Public function that could be external
      if (this.isRuleEnabled('sol-005', config)) {
        const publicFunctions = this.detectPublicFunctionsThatCouldBeExternal(code);
        findings.push(...publicFunctions.map(location => ({
          ruleId: 'sol-005',
          message: 'Function is public but could be external to save gas',
          severity: this.getRuleSeverity('sol-005', config),
          location: {
            file: filePath,
            ...location,
          },
          estimatedGasSavings: 300,
          suggestedFix: {
            description: 'Change function visibility from public to external',
            documentationUrl: 'https://docs.gasguard.dev/rules/sol-005',
          },
        })));
      }
      
      // Rule: sol-006 - Missing Reentrancy Guard
      if (this.isRuleEnabled('sol-006', config)) {
        const missingGuards = this.detectMissingReentrancyGuards(code);
        findings.push(...missingGuards.map(location => ({
          ruleId: 'sol-006',
          message: 'Function transfers ETH/tokens but lacks reentrancy guard',
          severity: this.getRuleSeverity('sol-006', config),
          location: {
            file: filePath,
            ...location,
          },
          suggestedFix: {
            description: 'Add reentrancy guard modifier to prevent reentrancy attacks',
            codeSnippet: 'function withdraw() external nonReentrant { ... }',
            documentationUrl: 'https://docs.gasguard.dev/rules/sol-006',
          },
        })));
      }

      // Rule: sol-007 - Insecure Fallback Function
      if (this.isRuleEnabled('sol-007', config)) {
        const insecureFallbacks = this.detectInsecureFallbackFunctions(code);
        findings.push(...insecureFallbacks.map(location => ({
          ruleId: 'sol-007',
          message: 'Fallback/receive handler is permissive or executes sensitive logic without strict validation',
          severity: this.getRuleSeverity('sol-007', config),
          location: {
            file: filePath,
            ...location,
          },
          suggestedFix: {
            description: 'Keep fallback minimal: reject unknown calls, avoid sensitive logic, and validate accepted ETH transfers',
            codeSnippet: 'fallback() external payable {\n    revert("Unknown function call");\n}',
            documentationUrl: 'https://docs.gasguard.dev/rules/sol-007',
          },
        })));
      }

      // Rule: sol-009 - Missing Timelock For Sensitive Operations
      if (this.isRuleEnabled('sol-009', config)) {
        const missingTimelocks = this.detectMissingTimelockForSensitiveOperations(code);
        findings.push(...missingTimelocks.map(location => ({
          ruleId: 'sol-009',
          message: location.message,
          severity: this.getRuleSeverity('sol-009', config),
          location: {
            file: filePath,
            startLine: location.startLine,
            endLine: location.endLine,
          },
          suggestedFix: {
            description: 'Use a timelock flow: schedule operation, enforce delay with block.timestamp checks, and execute after delay with role-based access control',
            codeSnippet: 'bytes32 opId = keccak256(data);\npendingOperations[opId] = block.timestamp + TIMELOCK_DELAY;\nemit OperationScheduled(opId, pendingOperations[opId]);\n\nrequire(block.timestamp >= pendingOperations[opId], "Timelock not expired");\nexecuteOperation(opId);\nemit OperationExecuted(opId);',
            documentationUrl: 'https://docs.gasguard.dev/rules/sol-009',
      // Rule: sol-008 - Unsafe External Calls
      if (this.isRuleEnabled('sol-008', config)) {
        const unsafeExternalCalls = this.detectUnsafeExternalCalls(code);
        findings.push(...unsafeExternalCalls.map(loc => ({
          ruleId: 'sol-008',
          message: loc.message,
          severity: this.getRuleSeverity('sol-008', config),
          location: {
            file: filePath,
            startLine: loc.startLine,
            endLine: loc.endLine,
          },
          suggestedFix: {
            description:
              'Validate all external calls: capture and check return values, follow the Checks-Effects-Interactions pattern, and avoid delegatecall to untrusted contracts',
            codeSnippet:
              '// Capture and validate return value\n(bool success, ) = addr.call{value: amount}("");\nrequire(success, "External call failed");\n\n// Follow CEI: update state BEFORE the external call\nbalances[msg.sender] = 0;\n(bool ok, ) = msg.sender.call{value: amount}("");\nrequire(ok, "Transfer failed");',
            documentationUrl: 'https://docs.gasguard.dev/rules/sol-008',
          },
        })));
      }
    } catch (error) {
      errors.push({
        file: filePath,
        message: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error : undefined,
      });
    }
    
    const analysisTime = Date.now() - startTime;
    
    return {
      findings,
      filesAnalyzed: 1,
      analysisTime,
      analyzerVersion: this.getVersion(),
      summary: this.calculateSummary(findings),
      totalEstimatedGasSavings: this.calculateTotalGasSavings(findings),
      errors: errors.length > 0 ? errors : undefined,
    };
  }
  
  
  private isRuleEnabled(ruleId: string, config?: AnalyzerConfig): boolean {
    const cfg = config || this.config;
    
    if (!cfg.rules || !(ruleId in cfg.rules)) {
      // Use default enabled state from rule definition
      const rule = this.getRule(ruleId);
      return rule?.enabled ?? true;
    }
    
    const ruleConfig = cfg.rules[ruleId];
    
    if (typeof ruleConfig === 'boolean') {
      return ruleConfig;
    }
    
    return ruleConfig.enabled ?? true;
  }
  
  
  private getRuleSeverity(ruleId: string, config?: AnalyzerConfig): Severity {
    const cfg = config || this.config;
    const rule = this.getRule(ruleId);
    
    if (!rule) {
      return Severity.MEDIUM;
    }
    
    if (cfg.rules && ruleId in cfg.rules) {
      const ruleConfig = cfg.rules[ruleId];
      if (typeof ruleConfig === 'object' && ruleConfig.severity) {
        return ruleConfig.severity;
      }
    }
    
    return rule.severity;
  }
  
  
  private detectUncachedArrayLength(code: string): Array<{ startLine: number; endLine: number }> {
    const findings: Array<{ startLine: number; endLine: number }> = [];
    const lines = code.split('\n');
    
    // Simple regex to detect for loops with .length in condition
    const forLoopPattern = /for\s*\([^)]*\.length[^)]*\)/;
    
    lines.forEach((line, index) => {
      if (forLoopPattern.test(line)) {
        findings.push({
          startLine: index + 1,
          endLine: index + 1,
        });
      }
    });
    
    return findings;
  }
  
  private detectInefficientIncrements(code: string): Array<{ startLine: number; endLine: number }> {
    const findings: Array<{ startLine: number; endLine: number }> = [];
    const lines = code.split('\n');
    
    // Detect i++ in for loops (but not ++i)
    const inefficientIncrementPattern = /\bi\+\+(?!\s*\))/;
    
    lines.forEach((line, index) => {
      if (line.includes('for') && inefficientIncrementPattern.test(line)) {
        findings.push({
          startLine: index + 1,
          endLine: index + 1,
        });
      }
    });
    
    return findings;
  }
  
  private detectPublicFunctionsThatCouldBeExternal(code: string): Array<{ startLine: number; endLine: number }> {
    const findings: Array<{ startLine: number; endLine: number }> = [];
    const lines = code.split('\n');
    
    // Simple heuristic: public functions that are not called internally
    const publicFunctionPattern = /function\s+\w+\s*\([^)]*\)\s+public/;
    
    lines.forEach((line, index) => {
      if (publicFunctionPattern.test(line)) {
        findings.push({
          startLine: index + 1,
          endLine: index + 1,
        });
      }
    });
    
    return findings;
  }
  
  private detectUnnecessaryStorageUsage(code: string): Array<{ startLine: number; endLine: number }> {
    const findings: Array<{ startLine: number; endLine: number }> = [];
    const lines = code.split('\n');

    // Detect storage variables in function parameters or local variables
    const storagePattern = /\b(string|bytes|uint\[\]|address\[\])\s+storage\s+\w+/;

    lines.forEach((line, index) => {
      if (storagePattern.test(line) && !line.includes('function')) {
        findings.push({
          startLine: index + 1,
          endLine: index + 1,
        });
      }
    });

    return findings;
  }

  private detectMissingReentrancyGuards(code: string): Array<{ startLine: number; endLine: number }> {
    const findings: Array<{ startLine: number; endLine: number }> = [];
    const lines = code.split('\n');

    // Pattern to detect functions that transfer ETH or tokens
    const transferPatterns = [
      /\.transfer\s*\(/,
      /\.send\s*\(/,
      /\.call\s*\{.*value.*\}/,
      /address\s*\(\s*\w+\s*\)\.call\s*\{.*value.*\}/,
      /payable\s*\(\s*\w+\s*\)\.transfer\s*\(/,
      /payable\s*\(\s*\w+\s*\)\.send\s*\(/,
    ];

    // Pattern to detect reentrancy guard modifiers
    const guardPatterns = [
      /\bnonReentrant\b/,
      /\bnoReentrancy\b/,
      /\breentrancyGuard\b/,
      /\block\b/,
    ];

    // Find all function definitions
    const functionPattern = /^\s*function\s+(\w+)\s*\([^}]*\)\s*(\w+)?\s*(\w+)?\s*\{/;

    lines.forEach((line, index) => {
      const functionMatch = line.match(functionPattern);
      if (functionMatch) {
        const functionName = functionMatch[1];
        const functionStartLine = index + 1;

        // Check if function has reentrancy guard
        let hasGuard = false;
        for (let i = Math.max(0, index - 5); i <= Math.min(lines.length - 1, index + 5); i++) {
          const checkLine = lines[i];
          if (guardPatterns.some(pattern => pattern.test(checkLine))) {
            hasGuard = true;
            break;
          }
        }

        // If no guard, check if function transfers ETH/tokens
        if (!hasGuard) {
          // Look for transfer patterns in the function body
          let braceCount = 0;
          let inFunction = false;

          for (let i = index; i < lines.length; i++) {
            const currentLine = lines[i];
            braceCount += (currentLine.match(/\{/g) || []).length;
            braceCount -= (currentLine.match(/\}/g) || []).length;

            if (braceCount === 1 && !inFunction) {
              inFunction = true;
            }

            if (inFunction && transferPatterns.some(pattern => pattern.test(currentLine))) {
              findings.push({
                startLine: functionStartLine,
                endLine: functionStartLine,
              });
              break;
            }

            if (braceCount === 0 && inFunction) {
              break;
            }
          }
        }
      }
    });

    return findings;
  }

  private detectInsecureFallbackFunctions(code: string): Array<{ startLine: number; endLine: number }> {
    const findings: Array<{ startLine: number; endLine: number }> = [];
    const lines = code.split('\n');
    const fallbackDeclarationPattern = /^\s*(fallback|receive)\s*\(\s*\)\s*[^;{]*\{/;

    const hasSensitiveOperation = (body: string): boolean => {
      const sensitivePatterns = [
        /\bdelegatecall\s*\(/,
        /\bcallcode\s*\(/,
        /\bselfdestruct\s*\(/,
        /\.call\s*\{/,
        /\.transfer\s*\(/,
        /\.send\s*\(/,
      ];

      return sensitivePatterns.some(pattern => pattern.test(body));
    };

    const hasStateMutation = (bodyLines: string[]): boolean => {
      const localDeclarationPattern = /^\s*(?:u?int(?:8|16|32|64|128|256)?|address|bool|string|bytes(?:\d+)?|bytes|mapping\s*\(|var|memory|storage)\b/;
      const stateMutationPattern = /\b[A-Za-z_]\w*(?:\[[^\]]+\])?\s*(?:\+\+|--|\+=|-=|\*=|\/=|%=|=)\s*[^=]/;

      for (const line of bodyLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
          continue;
        }

        if (trimmed.startsWith('emit ')) {
          continue;
        }

        if (localDeclarationPattern.test(trimmed)) {
          continue;
        }

        if (stateMutationPattern.test(trimmed)) {
          return true;
        }
      }

      return false;
    };

    const hasExplicitReject = (body: string): boolean => {
      return /\brevert\s*\(/.test(body) || /\brequire\s*\(\s*false\b/.test(body) || /\bassert\s*\(\s*false\b/.test(body);
    };

    const hasInputValidation = (body: string): boolean => {
      const validationPatterns = [
        /\brequire\s*\([^)]*msg\.(sender|value|data)[^)]*\)/,
        /\bif\s*\([^)]*msg\.(sender|value|data)[^)]*\)\s*\{?\s*revert\s*\(/,
      ];

      return validationPatterns.some(pattern => pattern.test(body));
    };

    const isOnlyEventsOrNoop = (bodyLines: string[]): boolean => {
      const executable = bodyLines
        .map(line => line.trim())
        .filter(line => line && line !== '{' && line !== '}' && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*'));

      if (executable.length === 0) {
        return true;
      }

      return executable.every(line => line.startsWith('emit ') || line === ';');
    };

    for (let i = 0; i < lines.length; i++) {
      const declarationLine = lines[i];
      const declarationMatch = declarationLine.match(fallbackDeclarationPattern);

      if (!declarationMatch) {
        continue;
      }

      const handlerType = declarationMatch[1];
      const startLine = i + 1;
      let braceDepth = 0;
      const bodyLines: string[] = [];
      let started = false;

      for (let j = i; j < lines.length; j++) {
        const currentLine = lines[j];
        const openBraces = (currentLine.match(/\{/g) || []).length;
        const closeBraces = (currentLine.match(/\}/g) || []).length;

        if (openBraces > 0) {
          started = true;
        }

        if (started) {
          bodyLines.push(currentLine);
        }

        braceDepth += openBraces;
        braceDepth -= closeBraces;

        if (started && braceDepth === 0) {
          i = j;
          break;
        }
      }

      const body = bodyLines.join('\n');
      const sensitive = hasSensitiveOperation(body);
      const mutatesState = hasStateMutation(bodyLines);
      const explicitReject = hasExplicitReject(body);
      const validatesInput = hasInputValidation(body);
      const eventsOnly = isOnlyEventsOrNoop(bodyLines);

      const insecureFallback =
        handlerType === 'fallback' && !explicitReject && !validatesInput && !eventsOnly;

      const insecureReceive =
        handlerType === 'receive' && (sensitive || mutatesState) && !validatesInput;

      if (sensitive || mutatesState || insecureFallback || insecureReceive) {
        findings.push({
          startLine,
          endLine: startLine,
        });
      }
    }

    return findings;
  }

  private detectMissingTimelockForSensitiveOperations(
  /**
   * Detects unsafe external call patterns (sol-008):
   *  1. Unchecked return values from .call() / .staticcall()
   *  2. Any use of .delegatecall() — executes foreign code in local storage context
   *  3. Checks-Effects-Interactions (CEI) pattern violations — state mutations after external calls
   */
  private detectUnsafeExternalCalls(
    code: string,
  ): Array<{ startLine: number; endLine: number; message: string }> {
    const findings: Array<{ startLine: number; endLine: number; message: string }> = [];
    const lines = code.split('\n');

    const functionDecl = /^\s*function\s+(\w+)\s*\(([^)]*)\)\s*([^\{;]*)\{/;
    const sensitiveNamePattern = /(withdraw|transferOwnership|upgrade|set(?:Config|Parameter|Fee|Admin|Owner)?|grantRole|revokeRole|pause|unpause|mint|burn|treasury|emergency)/i;
    const schedulerNamePattern = /^(queue|schedule|propose)/i;
    const executeNamePattern = /^execute/i;
    const cancelNamePattern = /^cancel/i;

    const contractHasTracking = /(pending|queued|operations?|timelock|eta|executeAfter|unlockTime|operationId)/i.test(code);
    const contractHasSchedule = /function\s+(?:queue|schedule|propose)\w*\s*\(/i.test(code);
    const contractHasExecute = /function\s+execute\w*\s*\(/i.test(code);
    const contractHasCancel = /function\s+cancel\w*\s*\(/i.test(code);
    const hasTimelockEvents = /event\s+\w*(Scheduled|Executed|Cancelled|Canceled)\w*\s*\(/i.test(code);

    const hasDelayEnforcement = (body: string): boolean => {
      const delayPatterns = [
        /block\.timestamp\s*>=/,
        /block\.timestamp\s*>\s*/,
        /\+\s*(TIMELOCK|DELAY|timelock|delay)/,
        /executeAfter|unlockTime|eta|readyAt|scheduledAt/i,
      ];
      return delayPatterns.some(pattern => pattern.test(body));
    };

    const hasAuthorization = (signature: string, body: string): boolean => {
      const signatureAuth = /(onlyOwner|onlyAdmin|onlyRole|governance|timelockAdmin)/i;
      const bodyAuth = [
        /require\s*\([^)]*msg\.sender[^)]*(owner|admin|governance)[^)]*\)/i,
        /hasRole\s*\(/,
        /_checkRole\s*\(/,
        /onlyRole\s*\(/,
      ];

      if (signatureAuth.test(signature)) {
        return true;
      }

      return bodyAuth.some(pattern => pattern.test(body));
    };

    const hasTrackingReference = (body: string): boolean => {
      const patterns = [
        /pending|queued|operations?|operationId|opId/i,
        /mapping\s*\(/,
        /delete\s+\w+/,
      ];
      return patterns.some(pattern => pattern.test(body));
    };

    const isStateChanging = (body: string): boolean => {
      const stateChangePatterns = [
        /\b\w+\s*(?:\[[^\]]+\])?\s*(?:=|\+=|-=|\*=|\/=|%=)/,
        /\.transfer\s*\(/,
        /\.call\s*\{/,
        /\.send\s*\(/,
        /_grantRole\s*\(/,
        /_revokeRole\s*\(/,
      ];

      return stateChangePatterns.some(pattern => pattern.test(body));
    };

    let i = 0;
    while (i < lines.length) {
      const match = lines[i].match(functionDecl);
      if (!match) {
        i++;
        continue;
      }

      const functionName = match[1];
      const functionSignatureSuffix = match[3] || '';
      const functionStartLine = i + 1;

      let braceDepth = 0;
      let started = false;
      const bodyLines: string[] = [];
      let endIndex = i;

      for (let j = i; j < lines.length; j++) {
        const line = lines[j];
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;

        if (openBraces > 0) {
          started = true;
        }

        if (started) {
          bodyLines.push(line);
        }

        braceDepth += openBraces;
        braceDepth -= closeBraces;

        if (started && braceDepth === 0) {
          endIndex = j;
          break;
        }
      }

      const functionBody = bodyLines.join('\n');
      const isViewOrPure = /\b(view|pure)\b/.test(functionSignatureSuffix);
      const isSensitive = sensitiveNamePattern.test(functionName);
      const isScheduler = schedulerNamePattern.test(functionName);
      const isExecutor = executeNamePattern.test(functionName);
      const isCanceller = cancelNamePattern.test(functionName);
      const hasAuth = hasAuthorization(functionSignatureSuffix, functionBody);

      // Scheduling / execution / cancellation operations should be role restricted.
      if ((isScheduler || isExecutor || isCanceller) && !hasAuth) {
        findings.push({
          startLine: functionStartLine,
          endLine: functionStartLine,
          message: `Timelock operation '${functionName}' lacks authorization checks`,
        });
      }

      // Execution operations must enforce delay.
      if (isExecutor && !hasDelayEnforcement(functionBody)) {
        findings.push({
          startLine: functionStartLine,
          endLine: functionStartLine,
          message: `Execution function '${functionName}' does not enforce timelock delay`,
        });
      }

      // Sensitive state-changing operations should not execute immediately.
      if (isSensitive && !isScheduler && !isExecutor && !isCanceller && !isViewOrPure) {
        const stateChanging = isStateChanging(functionBody);
        if (stateChanging) {
          const hasDelay = hasDelayEnforcement(functionBody);
          const hasTracking = hasTrackingReference(functionBody) || contractHasTracking;
          const contractHasTimelockFlow = contractHasSchedule && contractHasExecute;

          if (!hasDelay || !hasTracking || !contractHasTimelockFlow) {
            findings.push({
              startLine: functionStartLine,
              endLine: functionStartLine,
              message: `Sensitive operation '${functionName}' lacks enforced timelock scheduling/delay`,
            });
          }
        }
      }

      i = endIndex + 1;
    }

    // Timelock systems should expose cancellation and event telemetry.
    if (contractHasSchedule && contractHasExecute && !contractHasCancel) {
      findings.push({
        startLine: 1,
        endLine: 1,
        message: 'Timelock flow is missing cancellation capability for queued operations',
      });
    }

    if ((contractHasSchedule || contractHasExecute || contractHasCancel) && !hasTimelockEvents) {
      findings.push({
        startLine: 1,
        endLine: 1,
        message: 'Timelock operations should emit schedule/execute/cancel events for transparency',
      });
    // Helpers ----------------------------------------------------------------

    /** Returns true when the line (or the immediately preceding line) contains a
     *  boolean-capture pattern such as `(bool success,` or `(bool ok,`. */
    const hasBoolCapture = (lineIdx: number): boolean => {
      const boolPattern = /\(\s*bool\b/;
      if (boolPattern.test(lines[lineIdx])) return true;
      if (lineIdx > 0 && boolPattern.test(lines[lineIdx - 1])) return true;
      return false;
    };

    /** Returns true when the trimmed string is a comment or empty. */
    const isCommentOrEmpty = (s: string): boolean =>
      !s || s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');

    // Track multi-line block comments so we never inspect comment bodies.
    let inBlockComment = false;

    // Pass 1 — line-by-line checks -----------------------------------------
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // Block-comment gating
      if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) inBlockComment = true;
      if (inBlockComment) {
        if (trimmed.includes('*/')) inBlockComment = false;
        continue;
      }
      if (trimmed.startsWith('//')) continue;

      // 1a. delegatecall — always flag regardless of return-value capture.
      //     delegatecall executes external bytecode inside the caller's own
      //     storage; using it with an untrusted or upgradeable target is
      //     critically dangerous.
      if (/\.delegatecall\s*\(/.test(lines[i])) {
        findings.push({
          startLine: i + 1,
          endLine: i + 1,
          message:
            'Use of delegatecall detected — target executes in caller storage context; ' +
            'ensure the target contract is trusted, audited, and non-upgradeable',
        });
        continue; // Don't also fire the generic unchecked-call rule for the same line.
      }

      // 1b. .call() / .staticcall() without boolean return-value capture.
      if (/\.(call|staticcall)\s*[\({]/.test(lines[i]) && !hasBoolCapture(i)) {
        findings.push({
          startLine: i + 1,
          endLine: i + 1,
          message:
            'External call return value not checked — always capture and validate: ' +
            '(bool success, ) = addr.call(...); require(success, "Call failed")',
        });
      }
    }

    // Pass 2 — function-scope CEI analysis ----------------------------------
    // Walk function bodies and flag any mapping / state-variable write that
    // appears AFTER the first external call inside the same function.

    const externalCallInBody =
      /\.(call|delegatecall|staticcall)\s*[\({]|\.transfer\s*\(|\.send\s*\(/;

    // Identifies mapping-style state mutations: `someMapping[key] op= value`
    const mappingMutation = /\b\w+\s*\[[^\]]+\]\s*(?:[+\-*\/%&|^]?=(?!=))/;

    // Keywords that introduce local variables — lines starting with these are
    // declarations, not state mutations.
    const localVarKeyword =
      /^\s*(?:uint(?:\d+)?|int(?:\d+)?|bool|address|bytes(?:\d+)?|string|mapping|struct|enum|memory|storage|calldata|var)\s+/;

    let j = 0;
    while (j < lines.length) {
      const funcMatch = lines[j].match(/^\s*function\s+(\w+)\s*\(/);
      if (funcMatch) {
        const functionStartLine = j + 1;
        let braceDepth = 0;
        const bodyLines: Array<{ line: string; num: number }> = [];
        let bodyStarted = false;

        // Collect all lines belonging to this function.
        for (let k = j; k < lines.length; k++) {
          const cl = lines[k];
          const opens = (cl.match(/\{/g) || []).length;
          const closes = (cl.match(/\}/g) || []).length;
          braceDepth += opens - closes;
          if (opens > 0) bodyStarted = true;
          if (bodyStarted) bodyLines.push({ line: cl, num: k + 1 });
          if (bodyStarted && braceDepth === 0) {
            j = k;
            break;
          }
        }

        // Find the first external call inside the function body.
        let firstCallLineNum = -1;
        for (const { line, num } of bodyLines) {
          const t = line.trim();
          if (!isCommentOrEmpty(t) && externalCallInBody.test(line)) {
            firstCallLineNum = num;
            break;
          }
        }

        // Look for state mutations AFTER that first external call.
        if (firstCallLineNum >= 0) {
          let ceiViolationFound = false;
          for (const { line, num } of bodyLines) {
            if (ceiViolationFound) break;
            if (num <= firstCallLineNum) continue;

            const t = line.trim();
            if (
              isCommentOrEmpty(t) ||
              t.startsWith('emit ') ||
              t.startsWith('require(') ||
              t.startsWith('revert') ||
              t === '}' ||
              localVarKeyword.test(line)
            ) {
              continue;
            }

            if (mappingMutation.test(t)) {
              findings.push({
                startLine: functionStartLine,
                endLine: functionStartLine,
                message:
                  'Checks-Effects-Interactions (CEI) violation — state is mutated after an external call; ' +
                  'move all state updates before the external interaction to prevent reentrancy',
              });
              ceiViolationFound = true;
            }
          }
        }
      }
      j++;
    }

    return findings;
  }
}