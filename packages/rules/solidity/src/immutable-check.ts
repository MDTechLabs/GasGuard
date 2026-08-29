export interface ImmutableConstantWarning {
  line: number;
  variableName: string;
  variableType: string;
  modifier: 'immutable' | 'constant';
  message: string;
  suggestedRefactor: string;
}

interface StateVariable {
  name: string;
  type: string;
  line: number;
  visibility: string;
  hasConstant: boolean;
  hasImmutable: boolean;
  hasInlineInitializer: boolean;
}

interface FunctionBody {
  name: string;
  startLine: number;
  endLine: number;
  body: string;
}

function stripComments(code: string): string {
  return code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractStateVariables(sourceCode: string): StateVariable[] {
  const variables: StateVariable[] = [];
  const lines = sourceCode.split('\n');
  const stateVarPattern = /^\s*(mapping\s*\(|[A-Za-z_$][\w$]*(?:\[\])*(?:\s*<[^>]+>)?)\s+(constant\s+)?(immutable\s+)?(public|private|internal|external)?\s*([A-Za-z_$][\w$]*)\s*(?:=\s*[^;]+)?\s*;/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^(function|event|modifier|constructor|struct|enum|interface|library)\s/.test(trimmed)) {
      break;
    }

    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      continue;
    }

    const match = line.match(stateVarPattern);
    if (match) {
      const hasInlineInitializer = /=\s*[^;]+;/.test(line);
      variables.push({
        name: match[5],
        type: match[1].trim(),
        line: i + 1,
        visibility: match[4] || 'internal',
        hasConstant: match[2] !== undefined,
        hasImmutable: match[3] !== undefined,
        hasInlineInitializer,
      });
    }
  }

  return variables;
}

function extractFunctionBodies(sourceCode: string): FunctionBody[] {
  const functions: FunctionBody[] = [];
  const lines = sourceCode.split('\n');
  const funcPattern = /^\s*(function\s+(\w+)|constructor)\s*\([^)]*\)\s*[^{]*\{/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(funcPattern);
    if (match) {
      let braceDepth = 0;
      const bodyLines: string[] = [];
      let bodyStarted = false;

      for (let j = i; j < lines.length; j++) {
        const line = lines[j];
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;

        if (opens > 0) bodyStarted = true;
        if (bodyStarted) bodyLines.push(line);
        braceDepth += opens - closes;

        if (bodyStarted && braceDepth === 0) {
          functions.push({
            name: match[2] || 'constructor',
            startLine: i + 1,
            endLine: j + 1,
            body: bodyLines.slice(1, -1).join('\n'),
          });
          break;
        }
      }
    }
  }

  return functions;
}

function isVariableWrittenInBody(body: string, varName: string): boolean {
  const assignmentPattern = new RegExp(`\\b${varName}\\b\\s*(?:\\[.*?\\])?\\s*=[^=]`);
  return assignmentPattern.test(body);
}

function isConstantCandidate(variable: StateVariable): boolean {
  return !variable.hasConstant && !variable.hasImmutable && variable.hasInlineInitializer;
}

function isImmutableCandidate(variable: StateVariable): boolean {
  return !variable.hasConstant && !variable.hasImmutable && !variable.hasInlineInitializer;
}

export class SolidityImmutableCheckRule {
  public static readonly RULE_ID = 'solidity-immutable-check';

  public analyze(sourceCode: string): ImmutableConstantWarning[] {
    const warnings: ImmutableConstantWarning[] = [];
    const strippedCode = stripComments(sourceCode);
    const stateVariables = extractStateVariables(strippedCode);
    const functions = extractFunctionBodies(strippedCode);

    for (const variable of stateVariables) {
      if (variable.hasConstant || variable.hasImmutable) {
        continue;
      }

      const constructorFunc = functions.find(f => f.name === 'constructor');
      const nonConstructorFuncs = functions.filter(f => f.name !== 'constructor');

      if (isConstantCandidate(variable)) {
        const writtenInConstructor = constructorFunc && isVariableWrittenInBody(constructorFunc.body, variable.name);
        const writtenOutside = nonConstructorFuncs.some(f => isVariableWrittenInBody(f.body, variable.name));

        if (!writtenInConstructor && !writtenOutside) {
          warnings.push({
            line: variable.line,
            variableName: variable.name,
            variableType: variable.type,
            modifier: 'constant',
            message: `State variable '${variable.name}' is only assigned at declaration. Consider marking as 'constant' to save gas.`,
            suggestedRefactor: `${variable.type} constant ${variable.visibility} ${variable.name} = <value>;`,
          });
        }
      } else if (isImmutableCandidate(variable)) {
        const writtenInConstructor = constructorFunc && isVariableWrittenInBody(constructorFunc.body, variable.name);
        const writtenOutside = nonConstructorFuncs.some(f => isVariableWrittenInBody(f.body, variable.name));

        if (writtenInConstructor && !writtenOutside) {
          warnings.push({
            line: variable.line,
            variableName: variable.name,
            variableType: variable.type,
            modifier: 'immutable',
            message: `State variable '${variable.name}' is only assigned in the constructor. Consider marking as 'immutable' to save gas.`,
            suggestedRefactor: `${variable.type} immutable ${variable.visibility} ${variable.name};`,
          });
        }
      }
    }

    return warnings;
  }
}
