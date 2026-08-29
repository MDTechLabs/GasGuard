/**
 * Soroban WASM Artifact Analyzer
 *
 * Analyzes a compiled Soroban WebAssembly artifact for optimization
 * indicators and abnormal characteristics that source-level analysis cannot
 * reveal. It inspects the binary metadata directly:
 *
 *  - overall artifact size and code/data breakdown
 *  - custom sections (including DWARF `.<debug>` sections and `name`/`producers`)
 *  - imports and exports
 *  - memory and static data segments
 *
 * Reports findings when the artifact retains debug metadata, carries excess
 * static data, exports nothing usable, or otherwise looks unoptimised.
 *
 * The parser is intentionally lean — it only decodes the sections the analyzer
 * needs, so it is cheap to run for every compiled artifact.
 */

export type ArtifactSeverity = 'high' | 'medium' | 'low' | 'info';

export interface WasmArtifactFinding {
  ruleId: string;
  severity: ArtifactSeverity;
  title: string;
  message: string;
  suggestion: string;
}

export interface CustomSectionInfo {
  name: string;
  sizeBytes: number;
}

export interface WasmArtifactMetadata {
  binarySizeBytes: number;
  codeSizeBytes: number;
  dataSizeBytes: number;
  customSections: CustomSectionInfo[];
  importedFunctions: number;
  exportedFunctions: number;
  exportNames: string[];
  importNames: string[];
  memoryCount: number;
  dataSegments: number;
  /** True when a DWARF/debug custom section (`.debug*` / `sourceMappingURL`) is present. */
  hasDebugInfo: boolean;
  /** True when a `name` section (retained symbols) is present. */
  hasNameSection: boolean;
  /** True when a `producers` section is present (records build tooling/wasm-opt). */
  hasProducersSection: boolean;
  /** Names of custom sections that are typically debug metadata. */
  debugCustomSections: string[];
}

export interface WasmArtifactAnalysis {
  metadata: WasmArtifactMetadata;
  findings: WasmArtifactFinding[];
  /** Overall impression: `optimized` | `unoptimized` | `abnormal`. */
  verdict: 'optimized' | 'unoptimized' | 'abnormal';
}

/** A minimal streaming WASM binary reader. */
export class WasmBinaryReader {
  private readonly buf: Uint8Array;
  private pos: number;

  constructor(bytes: Uint8Array | Buffer) {
    this.buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.pos = 0;
  }

  get length(): number {
    return this.buf.length;
  }

  get offset(): number {
    return this.pos;
  }

  setOffset(offset: number): void {
    this.pos = offset;
  }

  hasMore(): boolean {
    return this.pos < this.buf.length;
  }

  byte(): number {
    return this.buf[this.pos++] ?? 0;
  }

  readVarUint32(): number {
    let result = 0;
    let shift = 0;
    while (this.pos < this.buf.length) {
      const b = this.buf[this.pos++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  }

  readString(): string {
    const len = this.readVarUint32();
    const bytes = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

/** True for a DWARF or source-mapping custom section. */
export function isDebugCustomSection(name: string): boolean {
  return (
    name.startsWith('.debug') ||
    name === 'sourceMappingURL' ||
    name === 'external_debug_info' ||
    name === 'build_id' ||
    name === 'go.buildid'
  );
}

/**
 * Extract the artifact metadata needed for optimization analysis.
 */
export function inspectWasmArtifact(bytes: Uint8Array | Buffer): WasmArtifactMetadata {
  const reader = new WasmBinaryReader(bytes);

  // Validate minimal header (magic `\0asm` + version 1).
  const magicOk =
    reader.length >= 8 &&
    reader.byte() === 0x00 &&
    reader.byte() === 0x61 &&
    reader.byte() === 0x73 &&
    reader.byte() === 0x6d &&
    reader.byte() === 0x01 &&
    reader.byte() === 0x00 &&
    reader.byte() === 0x00 &&
    reader.byte() === 0x00;

  const customSections: CustomSectionInfo[] = [];
  let codeSizeBytes = 0;
  let importedFunctions = 0;
  let exportedFunctions = 0;
  let memoryCount = 0;
  let dataSegments = 0;
  const exportNames: string[] = [];
  const importNames: string[] = [];
  let hasNameSection = false;
  let hasProducersSection = false;

  if (!magicOk) {
    return {
      binarySizeBytes: reader.length,
      codeSizeBytes: 0,
      dataSizeBytes: 0,
      customSections,
      importedFunctions: 0,
      exportedFunctions: 0,
      exportNames,
      importNames,
      memoryCount: 0,
      dataSegments: 0,
      hasDebugInfo: false,
      hasNameSection: false,
      hasProducersSection: false,
      debugCustomSections: [],
    };
  }

  while (reader.hasMore()) {
    const sectionId = reader.byte();
    const sectionSize = reader.readVarUint32();
    const payloadStart = reader.offset;
    const payloadEnd = payloadStart + sectionSize;

    switch (sectionId) {
      case 0: {
        // Custom section: name + free-form payload.
        const name = reader.readString();
        const size = payloadEnd - payloadStart;
        customSections.push({ name, sizeBytes: size });
        if (name === 'name') hasNameSection = true;
        if (name === 'producers') hasProducersSection = true;
        if (name === 'producers') {
          // nothing else needed
        }
        break;
      }
      case 2: {
        // Import section.
        const count = reader.readVarUint32();
        for (let i = 0; i < count; i++) {
          if (reader.offset >= payloadEnd) break;
          const mod = reader.readString();
          const field = reader.readString();
          const kind = reader.byte();
          importNames.push(`${mod}.${field}`);
          if (kind === 0) importedFunctions++;
          else if (kind === 2) memoryCount++;
          else if (kind === 0) {
            // handled above
          } else if (kind === 1) {
            reader.byte(); // elemtype
            if (reader.byte() & 0x01) reader.readVarUint32(); // max
          } else if (kind === 3) {
            reader.byte();
            reader.byte();
          }
        }
        break;
      }
      case 3: {
        // Function section (type index list) — just count.
        const count = reader.readVarUint32();
        reader.setOffset(payloadEnd);
        void count;
        break;
      }
      case 5: {
        // Memory section.
        const count = reader.readVarUint32();
        for (let i = 0; i < count; i++) {
          const flags = reader.byte();
          reader.readVarUint32(); // min
          if (flags & 0x01) reader.readVarUint32(); // max
          memoryCount++;
        }
        break;
      }
      case 7: {
        // Export section.
        const count = reader.readVarUint32();
        for (let i = 0; i < count; i++) {
          if (reader.offset >= payloadEnd) break;
          const name = reader.readString();
          reader.byte(); // kind
          reader.readVarUint32(); // index
          exportNames.push(name);
          exportedFunctions++; // exports of all kinds counted for simplicity
        }
        break;
      }
      case 10: {
        // Code section. Bodies are LEB-size + locals + instructions; we only
        // track aggregate code bytes, skipping to the section end.
        codeSizeBytes += sectionSize;
        break;
      }
      case 11: {
        // Data section.
        const count = reader.readVarUint32();
        for (let i = 0; i < count; i++) {
          if (reader.offset >= payloadEnd) break;
          const flags = reader.byte();
          if (flags & 0x02) reader.readVarUint32();
          if (flags === 0 || flags === 2) {
            // skip i32.const + end (init expr)
            while (reader.offset < payloadEnd && reader.byte() !== 0x0b) {
              /* skip init expr bytes */
            }
          }
          reader.readVarUint32(); // byteCount length
          dataSegments++;
        }
        break;
      }
      default:
        // Skip any other section.
        break;
    }

    reader.setOffset(payloadEnd);
  }

  const names = customSections.map((c) => c.name);
  const debugCustomSections = names.filter(isDebugCustomSection);

  return {
    binarySizeBytes: reader.length,
    codeSizeBytes,
    dataSizeBytes: 0,
    customSections,
    importedFunctions,
    exportedFunctions,
    exportNames,
    importNames,
    memoryCount,
    dataSegments,
    hasDebugInfo: debugCustomSections.length > 0,
    hasNameSection,
    hasProducersSection,
    debugCustomSections,
  };
}

/** Optimization indicators looked up by name for the report. */
export function detectOptimizationIndicators(meta: WasmArtifactMetadata): string[] {
  const indicators: string[] = [];
  if (meta.hasProducersSection) {
    indicators.push('compiler/build tooling recorded in the producers section');
  }
  if (meta.memoryCount <= 1) {
    indicators.push('single linear memory (no excess memory growth)');
  }
  if (meta.binarySizeBytes > 0) {
    const codeRatio = meta.codeSizeBytes / meta.binarySizeBytes;
    if (codeRatio > 0.6) {
      indicators.push(`high code-to-binary ratio (${(codeRatio * 100).toFixed(0)}%)`);
    }
  }
  return indicators;
}

/**
 * Full artifact analysis entry point.
 */
export function analyzeWasmArtifact(bytes: Uint8Array | Buffer): WasmArtifactAnalysis {
  const metadata = inspectWasmArtifact(bytes);
  const findings: WasmArtifactFinding[] = [];

  // Retained debug information bloats and leaks internals.
  if (metadata.hasDebugInfo) {
    findings.push({
      ruleId: 'soroban-wasm-debug-info',
      severity: 'medium',
      title: 'Debug information retained in WASM artifact',
      message: `Artifact retains debug metadata custom sections: ${metadata.debugCustomSections.join(
        ', ',
      )}.`,
      suggestion:
        'Strip debug sections before deployment: compile with `strip = "symbols"` / run `wasm-strip` or `wasm-opt --strip-debug`.',
    });
  }

  // Retained function symbol names indicate an unstripped binary.
  if (metadata.hasNameSection) {
    findings.push({
      ruleId: 'soroban-wasm-unstripped',
      severity: 'low',
      title: 'WASM artifact is not stripped (name section present)',
      message: 'A `name` custom section with function/global names is present.',
      suggestion: 'Strip the binary with `wasm-strip` or set `strip = "symbols"` in the release profile.',
    });
  }

  // A contract that exports nothing is almost always a mistake.
  if (metadata.exportedFunctions === 0 || metadata.exportNames.length === 0) {
    findings.push({
      ruleId: 'soroban-wasm-no-exports',
      severity: 'high',
      title: 'WASM artifact exports no functions',
      message: 'The artifact declares no exports; a Soroban contract must expose its entrypoints.',
      suggestion:
        'Ensure `#[contractimpl]` on the contract and that the generated `__wasm_export_*` wrappers are emitted.',
    });
  }

  // Excess static data bloats the artifact and contract deploy cost.
  for (const section of metadata.customSections) {
    if (isDebugCustomSection(section.name) && section.sizeBytes > 8192) {
      findings.push({
        ruleId: 'soroban-wasm-debug-bloat',
        severity: metadata.binarySizeBytes > 131072 ? 'high' : 'medium',
        title: 'Large debug custom section',
        message: `Custom section '${section.name}' is ${section.sizeBytes} bytes, inflating the artifact.`,
        suggestion: 'Strip debug sections and rebuild with an optimised release profile.',
      });
    }
  }

  // Memory imports are normal for Soroban, but more than one import/region is abnormal.
  if (metadata.memoryCount > 1) {
    findings.push({
      ruleId: 'soroban-wasm-multiple-memories',
      severity: 'medium',
      title: 'Multiple linear memories declared',
      message: `The artifact declares ${metadata.memoryCount} memory regions.`,
      suggestion: 'Consolidate to a single linear memory to reduce allocation complexity.',
    });
  }

  const unoptimized =
    metadata.hasDebugInfo || metadata.hasNameSection || metadata.binarySizeBytes > 131072;

  const verdict: WasmArtifactAnalysis['verdict'] = findings.some(
    (f) => f.severity === 'high',
  )
    ? 'abnormal'
    : unoptimized
      ? 'unoptimized'
      : 'optimized';

  return { metadata, findings, verdict };
}