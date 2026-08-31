import { maskNonCode, extractFunctions } from '../../common/source-utils';

export interface AuthDepthResult {
  functionName: string;
  depth: number;
  path: string[];
  line: number;
}

export interface AuthorizationTreeReport {
  results: AuthDepthResult[];
  deepestFunction: AuthDepthResult | null;
  maxDepth: number;
  threshold: number;
  violations: AuthDepthResult[];
  recommendations: string[];
}

const DEFAULT_THRESHOLD = 3;

function countAuthNesting(source: string, fnBodyStart: number, fnBodyEnd: number): { depth: number; path: string[] } {
  const body = source.slice(fnBodyStart, fnBodyEnd);
  let depth = 0;
  let maxDepth = 0;
  const path: string[] = [];
  const stack: number[] = [];

  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') {
      stack.push(depth);
      depth++;
      if (depth > maxDepth) maxDepth = depth;
    } else if (body[i] === '}') {
      depth = stack.pop() ?? 0;
    }

    const rest = body.slice(i);
    const authMatch = rest.match(
      /^(\w+::)?(require_auth|authorize_as_parent|authorized|check_auth)\s*\(/,
    );
    if (authMatch && i === body.indexOf(authMatch[0])) {
      const label = authMatch[2];
      if (!path.includes(label)) {
        path.push(label);
      }
    }
  }

  return { depth: maxDepth, path };
}

function findAuthCalls(source: string): { name: string; line: number }[] {
  const masked = maskNonCode(source);
  const results: { name: string; line: number }[] = [];
  const authPatterns = [
    /(\w+::)?require_auth\s*\(/g,
    /(\w+::)?authorize_as_parent\s*\(/g,
    /(\w+::)?check_auth\s*\(/g,
    /(\w+::)?authorized\s*\(/g,
  ];

  let lineNum = 1;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '\n') lineNum++;

    for (const pattern of authPatterns) {
      pattern.lastIndex = i;
      const match = pattern.exec(masked);
      if (match && match.index === i) {
        results.push({ name: match[2] || match[0], line: lineNum });
      }
    }
  }

  return results;
}

export function measureAuthDepth(source: string, threshold: number = DEFAULT_THRESHOLD): AuthorizationTreeReport {
  const masked = maskNonCode(source);
  const fns = extractFunctions(masked, source);
  const results: AuthDepthResult[] = [];

  for (const fn of fns) {
    const authCalls = findAuthCalls(masked.slice(fn.bodyStart, fn.bodyEnd));
    const depth = authCalls.length;
    const path = authCalls.map((c) => c.name);

    results.push({
      functionName: fn.name,
      depth,
      path,
      line: fn.line,
    });
  }

  const deepest = results.reduce(
    (max, r) => (r.depth > (max?.depth ?? -1) ? r : max),
    null as AuthDepthResult | null,
  );

  const maxDepth = deepest?.depth ?? 0;
  const violations = results.filter((r) => r.depth >= threshold);

  const recommendations: string[] = [];
  if (violations.length > 0) {
    recommendations.push(
      `${violations.length} function(s) have authorization depth >= ${threshold}. Consider flattening auth checks.`,
    );
  }
  for (const v of violations) {
    if (v.depth >= threshold + 2) {
      recommendations.push(
        `'${v.functionName}' has critically deep auth nesting (${v.depth}). Extract nested auth into separate authorization helpers.`,
      );
    }
  }
  if (maxDepth >= threshold) {
    recommendations.push(
      `Deep authorization chains increase execution cost and complicate security review. Use composite auth patterns instead.`,
    );
  }

  return {
    results,
    deepestFunction: deepest,
    maxDepth,
    threshold,
    violations,
    recommendations,
  };
}
