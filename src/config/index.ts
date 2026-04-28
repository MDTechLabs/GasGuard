/**
 * AST Snapshot Debugger (Issue #223)
 *
 * Provides programmatic access to the GasGuard UnifiedAST for debugging.
 *
 * The parser layer (Rust/WASM or native TS stubs) is expected to produce
 * a `UnifiedAST` object.  This module adds:
 *  - `buildSnapshot`  — wraps an AST into a serialisable snapshot envelope
 *  - `renderTree`     — pretty-prints the AST as an indented ASCII tree for
 *                       terminal inspection
 *  - `snapshotToJson` — serialise to compact or pretty JSON
 *  - `parseAndSnapshot` — convenience: parse source text → snapshot
 *
 * All of these are consumed by the `gasguard ast` CLI command.
 */

// ---------------------------------------------------------------------------
// Shared AST node types (TypeScript mirror of libs/ast/src/lib.rs)
// ---------------------------------------------------------------------------

export type Language = 'Solidity' | 'Rust' | 'Vyper';

export interface ParamNode {
  name: string;
  type_name: string;
}

export interface FunctionNode {
  name: string;
  params: ParamNode[];
  return_type?: string;
  visibility: 'Public' | 'Private' | 'Internal' | 'External';
  decorators: string[];
  is_constructor: boolean;
  is_external: boolean;
  is_payable: boolean;
  line_number: number;
  body_raw: string;
}

export interface VariableNode {
  name: string;
  type_name: string;
  visibility: 'Public' | 'Private' | 'Internal' | 'External';
  is_constant: boolean;
  is_immutable: boolean;
  line_number: number;
}

export interface ContractNode {
  name: string;
  functions: FunctionNode[];
  state_variables: VariableNode[];
  line_number: number;
}

export interface StructNode {
  name: string;
  fields: VariableNode[];
  line_number: number;
}

export interface EnumNode {
  name: string;
  variants: string[];
  line_number: number;
}

export interface UnifiedAST {
  language: Language;
  source: string;
  file_path: string;
  contracts: ContractNode[];
  structs: StructNode[];
  enums: EnumNode[];
}

// ---------------------------------------------------------------------------
// Snapshot envelope
// ---------------------------------------------------------------------------

export interface ASTSnapshot {
  /** Tool version that produced this snapshot. */
  gasguard_version: string;
  /** ISO-8601 timestamp when the snapshot was taken. */
  captured_at: string;
  /** The full parsed AST. */
  ast: UnifiedAST;
  /** Quick-access stats for display in the terminal header. */
  stats: {
    contracts: number;
    functions: number;
    state_variables: number;
    structs: number;
    enums: number;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const GASGUARD_VERSION = '1.0.0';

/** Wrap a `UnifiedAST` in a snapshot envelope with metadata and stats. */
export function buildSnapshot(ast: UnifiedAST, version = GASGUARD_VERSION): ASTSnapshot {
  const totalFunctions = ast.contracts.reduce((n, c) => n + c.functions.length, 0);
  const totalVars = ast.contracts.reduce((n, c) => n + c.state_variables.length, 0);

  return {
    gasguard_version: version,
    captured_at: new Date().toISOString(),
    ast,
    stats: {
      contracts: ast.contracts.length,
      functions: totalFunctions,
      state_variables: totalVars,
      structs: ast.structs.length,
      enums: ast.enums.length,
    },
  };
}

/** Serialise a snapshot to a JSON string. */
export function snapshotToJson(snapshot: ASTSnapshot, pretty = false): string {
  return pretty
    ? JSON.stringify(snapshot, null, 2)
    : JSON.stringify(snapshot);
}

/**
 * Render a snapshot as a human-readable indented tree.
 *
 * Example output:
 * ```
 * [Solidity] vulnerable_bank.sol
 * └── contract VulnerableBank (line 3)
 *     ├── state: balance (uint256, Public)
 *     └── fn deposit() → void  [payable] (line 7)
 *         params: (none)
 * ```
 */
export function renderTree(snapshot: ASTSnapshot): string {
  const { ast, stats } = snapshot;
  const lines: string[] = [];

  lines.push(`[${ast.language}] ${ast.file_path}`);
  lines.push(`  Captured: ${snapshot.captured_at}  |  GasGuard v${snapshot.gasguard_version}`);
  lines.push(
    `  Stats: ${stats.contracts} contract(s), ${stats.functions} function(s), ` +
    `${stats.state_variables} state var(s), ${stats.structs} struct(s), ${stats.enums} enum(s)`,
  );
  lines.push('');

  // Contracts
  const contractLast = (i: number) => i === ast.contracts.length - 1;
  ast.contracts.forEach((contract, ci) => {
    const cBranch = contractLast(ci) ? '└── ' : '├── ';
    const cPad = contractLast(ci) ? '    ' : '│   ';
    lines.push(`${cBranch}contract ${contract.name} (line ${contract.line_number})`);

    // State variables
    const allItems = [
      ...contract.state_variables.map((v) => ({ kind: 'var' as const, item: v })),
      ...contract.functions.map((f) => ({ kind: 'fn' as const, item: f })),
    ];
    allItems.forEach(({ kind, item }, ii) => {
      const isLast = ii === allItems.length - 1;
      const branch = `${cPad}${isLast ? '└── ' : '├── '}`;
      if (kind === 'var') {
        const v = item as VariableNode;
        const flags = [
          v.is_constant ? 'constant' : null,
          v.is_immutable ? 'immutable' : null,
        ].filter(Boolean).join(', ');
        lines.push(
          `${branch}state: ${v.name} (${v.type_name}, ${v.visibility}${flags ? ', ' + flags : ''}) (line ${v.line_number})`,
        );
      } else {
        const f = item as FunctionNode;
        const tags = [
          f.is_constructor ? 'constructor' : null,
          f.is_external ? 'external' : null,
          f.is_payable ? 'payable' : null,
        ].filter(Boolean);
        const tagStr = tags.length ? `  [${tags.join(', ')}]` : '';
        const ret = f.return_type ?? 'void';
        lines.push(`${branch}fn ${f.name}() → ${ret}${tagStr} (line ${f.line_number})`);

        const fnPad = `${cPad}${isLast ? '    ' : '│   '}`;
        if (f.params.length === 0) {
          lines.push(`${fnPad}params: (none)`);
        } else {
          f.params.forEach((p, pi) => {
            const pBranch = `${fnPad}${pi === f.params.length - 1 ? '└── ' : '├── '}`;
            lines.push(`${pBranch}param: ${p.name}: ${p.type_name}`);
          });
        }
      }
    });
  });

  // Structs
  ast.structs.forEach((s, si) => {
    const isLast = si === ast.structs.length - 1 && ast.enums.length === 0;
    lines.push(`${isLast ? '└── ' : '├── '}struct ${s.name} (line ${s.line_number})`);
    s.fields.forEach((f, fi) => {
      const pad = isLast ? '    ' : '│   ';
      lines.push(`${pad}${fi === s.fields.length - 1 ? '└── ' : '├── '}field: ${f.name}: ${f.type_name}`);
    });
  });

  // Enums
  ast.enums.forEach((e, ei) => {
    const isLast = ei === ast.enums.length - 1;
    lines.push(`${isLast ? '└── ' : '├── '}enum ${e.name} (line ${e.line_number})`);
    e.variants.forEach((v, vi) => {
      const pad = isLast ? '    ' : '│   ';
      lines.push(`${pad}${vi === e.variants.length - 1 ? '└── ' : '├── '}${v}`);
    });
  });

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Lightweight source-level parser stubs
// (In production these delegate to the Rust WASM parser; here they parse
// enough structure for the debugger to be immediately useful.)
// ---------------------------------------------------------------------------

/**
 * Parse a Solidity source string into a `UnifiedAST`.
 *
 * This is an intentionally minimal, regex-based stub sufficient for the
 * debugger.  Production parsing happens in the Rust `libs/ast` crate via WASM.
 */
export function parseSolidity(source: string, filePath: string): UnifiedAST {
  const contracts: ContractNode[] = [];
  const structs: StructNode[] = [];
  const enums: EnumNode[] = [];
  const lines = source.split('\n');

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;

    // Contract
    const contractMatch = line.match(/^\s*contract\s+(\w+)/);
    if (contractMatch) {
      contracts.push({ name: contractMatch[1], functions: [], state_variables: [], line_number: lineNo });
      return;
    }

    // Struct
    const structMatch = line.match(/^\s*struct\s+(\w+)/);
    if (structMatch) {
      structs.push({ name: structMatch[1], fields: [], line_number: lineNo });
      return;
    }

    // Enum
    const enumMatch = line.match(/^\s*enum\s+(\w+)/);
    if (enumMatch) {
      enums.push({ name: enumMatch[1], variants: [], line_number: lineNo });
      return;
    }

    // Function (only inside a contract context)
    const fnMatch = line.match(/^\s*(function)\s+(\w+)\s*\(([^)]*)\).*?(public|private|internal|external)?.*?(payable)?/);
    if (fnMatch && contracts.length > 0) {
      const contract = contracts[contracts.length - 1];
      const paramStr = fnMatch[3].trim();
      const params: ParamNode[] = paramStr
        ? paramStr.split(',').map((p) => {
            const parts = p.trim().split(/\s+/);
            return { type_name: parts[0] ?? 'unknown', name: parts[1] ?? '_' };
          })
        : [];

      const vis = (fnMatch[4] ?? 'internal') as FunctionNode['visibility'];
      contract.functions.push({
        name: fnMatch[2],
        params,
        return_type: undefined,
        visibility: vis.charAt(0).toUpperCase() + vis.slice(1) as FunctionNode['visibility'],
        decorators: [],
        is_constructor: fnMatch[2] === 'constructor',
        is_external: vis === 'external',
        is_payable: !!fnMatch[5],
        line_number: lineNo,
        body_raw: '',
      });
      return;
    }

    // State variable (inside contract)
    const varMatch = line.match(/^\s*(uint\w*|int\w*|address|bool|bytes\w*|string|mapping[^;]*)\s+(public|private|internal)?\s*(\w+)\s*;/);
    if (varMatch && contracts.length > 0) {
      const contract = contracts[contracts.length - 1];
      const vis = (varMatch[2] ?? 'internal') as VariableNode['visibility'];
      contract.state_variables.push({
        name: varMatch[3],
        type_name: varMatch[1],
        visibility: vis.charAt(0).toUpperCase() + vis.slice(1) as VariableNode['visibility'],
        is_constant: line.includes('constant'),
        is_immutable: line.includes('immutable'),
        line_number: lineNo,
      });
    }
  });

  return { language: 'Solidity', source, file_path: filePath, contracts, structs, enums };
}

/**
 * Parse a Rust (Soroban) source string into a `UnifiedAST`.
 * Stub implementation — production version uses the Rust crate.
 */
export function parseRust(source: string, filePath: string): UnifiedAST {
  const contracts: ContractNode[] = [];
  const structs: StructNode[] = [];
  const enums: EnumNode[] = [];
  const lines = source.split('\n');

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;

    const structMatch = line.match(/^\s*(?:pub\s+)?struct\s+(\w+)/);
    if (structMatch) {
      structs.push({ name: structMatch[1], fields: [], line_number: lineNo });
      // Treat top-level struct as a "contract" for Soroban
      contracts.push({ name: structMatch[1], functions: [], state_variables: [], line_number: lineNo });
    }

    const enumMatch = line.match(/^\s*(?:pub\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      enums.push({ name: enumMatch[1], variants: [], line_number: lineNo });
    }

    const fnMatch = line.match(/^\s*(?:pub\s+)?fn\s+(\w+)\s*\(([^)]*)\)/);
    if (fnMatch && contracts.length > 0) {
      const paramStr = fnMatch[2].trim();
      const params: ParamNode[] = paramStr
        ? paramStr.split(',').map((p) => {
            const parts = p.trim().split(':');
            return { name: (parts[0] ?? '_').trim(), type_name: (parts[1] ?? 'unknown').trim() };
          })
        : [];
      contracts[contracts.length - 1].functions.push({
        name: fnMatch[1],
        params,
        return_type: undefined,
        visibility: 'Public',
        decorators: [],
        is_constructor: false,
        is_external: false,
        is_payable: false,
        line_number: lineNo,
        body_raw: '',
      });
    }
  });

  return { language: 'Rust', source, file_path: filePath, contracts, structs, enums };
}

/**
 * Auto-detect language from file extension and parse.
 */
export function parseSource(source: string, filePath: string): UnifiedAST {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'sol') return parseSolidity(source, filePath);
  if (ext === 'rs') return parseRust(source, filePath);
  // Fallback: treat as Vyper (no deep stub needed for display)
  return {
    language: 'Vyper',
    source,
    file_path: filePath,
    contracts: [],
    structs: [],
    enums: [],
  };
}

/** Parse source and return a ready-to-use snapshot. */
export function parseAndSnapshot(source: string, filePath: string): ASTSnapshot {
  return buildSnapshot(parseSource(source, filePath));
}
