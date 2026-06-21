export interface SafeIntTypesResult {
  detected: boolean;
  overSized: Array<{
    kind: 'param' | 'return' | 'variable';
    name: string;
    type: string;
    suggested: string;
    snippet: string;
  }>;
  message: string;
  suggestion: string;
}

const BIG_INT_PATTERN = /\b(i128|u128)\b/g;

const BIG_INT_PARAM = /(\w+)\s*:\s*(i128|u128)\b/g;

const BIG_INT_RETURN = /->\s*(i128|u128)\b/g;

const BIG_INT_VAR = /(let|const|mut)\s+(\w+)\s*:\s*(i128|u128)\b/g;

export function detectUnsafeIntTypes(code: string): SafeIntTypesResult {
  const overSized: SafeIntTypesResult['overSized'] = [];

  for (const match of code.matchAll(BIG_INT_PARAM)) {
    const name = match[1];
    const type = match[2];
    if (name === 'amount' || name === 'balance' || name === 'total_supply') continue;
    overSized.push({
      kind: 'param',
      name,
      type,
      suggested: type === 'i128' ? 'i64' : 'u64',
      snippet: match[0].slice(0, 60),
    });
  }

  for (const match of code.matchAll(BIG_INT_RETURN)) {
    const type = match[1];
    const suggested = type === 'i128' ? 'i64' : 'u64';
    overSized.push({
      kind: 'return',
      name: 'return type',
      type,
      suggested,
      snippet: match[0].slice(0, 60),
    });
  }

  for (const match of code.matchAll(BIG_INT_VAR)) {
    const name = match[2];
    const type = match[3];
    if (name === 'amount' || name === 'balance' || name === 'total_supply') continue;
    overSized.push({
      kind: 'variable',
      name,
      type,
      suggested: type === 'i128' ? 'i64' : 'u64',
      snippet: match[0].slice(0, 60),
    });
  }

  if (overSized.length === 0) {
    return {
      detected: false,
      overSized: [],
      message: 'No oversized integer types detected.',
      suggestion: '',
    };
  }

  return {
    detected: true,
    overSized,
    message: `${overSized.length} use(s) of i128/u128 where smaller types may suffice.`,
    suggestion: 'Prefer i64/u64 or i32/u32 for bounded values to reduce storage and computation costs. Reserve i128/u128 for amounts, balances, and total supply.',
  };
}
