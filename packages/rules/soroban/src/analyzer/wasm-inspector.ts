/**
 * Soroban Low-Level Memory Layout Analyzer
 * 
 * Examines compiled Soroban WebAssembly (.wasm) bytecode binaries to pinpoint
 * unoptimized memory allocations, host import call frequencies, static data bloat,
 * stack frame allocations, and correlate WASM bytecode inefficiencies back to source Rust file line numbers.
 */

export interface WasmSourceLocation {
  file: string;
  line: number;
  column?: number;
  functionName?: string;
}

export type FindingCategory =
  | 'memory-bloat'
  | 'host-import-frequency'
  | 'allocator-overhead'
  | 'stack-bloat'
  | 'unaligned-memory';

export type FindingSeverity = 'high' | 'medium' | 'low';

export interface WasmInefficiencyFinding {
  id: string;
  title: string;
  category: FindingCategory;
  severity: FindingSeverity;
  message: string;
  suggestion: string;
  binaryOffset: number;
  sourceLocation?: WasmSourceLocation;
  metrics?: Record<string, number | string | boolean>;
}

export interface WasmMemoryAllocation {
  initialPages: number;
  maxPages?: number;
  initialSizeBytes: number;
  maxSizeBytes?: number;
}

export interface WasmDataSegment {
  index: number;
  memoryIndex: number;
  offset: number;
  sizeBytes: number;
  preview?: string;
}

export interface WasmImportInfo {
  module: string;
  field: string;
  kind: 'function' | 'table' | 'memory' | 'global';
  typeIndex?: number;
  funcIndex?: number;
}

export interface WasmExportInfo {
  name: string;
  kind: 'function' | 'table' | 'memory' | 'global';
  index: number;
}

export interface WasmFunctionAnalysis {
  funcIndex: number;
  name?: string;
  typeIndex: number;
  bodyOffset: number;
  bodySizeBytes: number;
  instructionCount: number;
  hostCallCount: number;
  memoryGrowCount: number;
  maxStackFrameBytes: number;
  unalignedAccessCount: number;
}

export interface WasmAnalysisResult {
  binarySizeBytes: number;
  memoryAllocations: WasmMemoryAllocation[];
  totalStaticDataSizeBytes: number;
  dataSegments: WasmDataSegment[];
  importedFunctionsCount: number;
  definedFunctionsCount: number;
  imports: WasmImportInfo[];
  exports: WasmExportInfo[];
  hostImportCallFrequency: Record<string, number>;
  functionAnalyses: WasmFunctionAnalysis[];
  findings: WasmInefficiencyFinding[];
  sourceMappingAvailable: boolean;
}

export interface WasmInspectorOptions {
  maxAllowedMemoryPages?: number; // default: 1 page (64KB)
  maxAllowedStaticDataSizeBytes?: number; // default: 4096 bytes (4KB)
  maxHostImportCallsPerFunction?: number; // default: 5 calls
  maxStackAllocationBytes?: number; // default: 1024 bytes
  warnOnDynamicMemoryGrow?: boolean; // default: true
  warnOnUnalignedMemoryAccess?: boolean; // default: true
}

export class WasmParser {
  private buffer: Uint8Array;
  private offset: number = 0;

  constructor(wasmBinary: Uint8Array | Buffer) {
    this.buffer = new Uint8Array(wasmBinary);
  }

  public validateHeader(): boolean {
    if (this.buffer.length < 8) return false;
    // Magic number: \0asm -> 0x00 0x61 0x73 0x6d
    if (
      this.buffer[0] !== 0x00 ||
      this.buffer[1] !== 0x61 ||
      this.buffer[2] !== 0x73 ||
      this.buffer[3] !== 0x6d
    ) {
      return false;
    }
    // Version: 1 -> 0x01 0x00 0x00 0x00
    if (
      this.buffer[4] !== 0x01 ||
      this.buffer[5] !== 0x00 ||
      this.buffer[6] !== 0x00 ||
      this.buffer[7] !== 0x00
    ) {
      return false;
    }
    return true;
  }

  public parse(): WasmParsedModule {
    if (!this.validateHeader()) {
      throw new Error('Invalid WebAssembly binary header');
    }

    this.offset = 8; // skip magic & version
    const module: WasmParsedModule = {
      customSections: [],
      types: [],
      imports: [],
      functions: [],
      memories: [],
      globals: [],
      exports: [],
      dataSegments: [],
      codeBodies: [],
      functionNames: new Map<number, string>(),
      sourceLines: new Map<number, WasmSourceLocation>(),
    };

    let importedFuncCount = 0;

    while (this.offset < this.buffer.length) {
      const sectionId = this.buffer[this.offset++];
      const sectionLength = this.readVarUint32();
      const payloadStart = this.offset;
      const payloadEnd = payloadStart + sectionLength;

      switch (sectionId) {
        case 0: // Custom section
          this.parseCustomSection(payloadStart, payloadEnd, module);
          break;
        case 1: // Type section
          this.parseTypeSection(payloadEnd, module);
          break;
        case 2: // Import section
          importedFuncCount = this.parseImportSection(payloadEnd, module);
          break;
        case 3: // Function section
          this.parseFunctionSection(payloadEnd, module);
          break;
        case 5: // Memory section
          this.parseMemorySection(payloadEnd, module);
          break;
        case 6: // Global section
          this.parseGlobalSection(payloadEnd, module);
          break;
        case 7: // Export section
          this.parseExportSection(payloadEnd, module);
          break;
        case 10: // Code section
          this.parseCodeSection(payloadStart, payloadEnd, module, importedFuncCount);
          break;
        case 11: // Data section
          this.parseDataSection(payloadStart, payloadEnd, module);
          break;
        default:
          // Skip unhandled sections
          break;
      }

      this.offset = payloadEnd;
    }

    // Try extracting source line locations from embedded strings or name sections if available
    this.extractEmbeddedSourceLocations(module);

    return module;
  }

  private parseCustomSection(payloadStart: number, payloadEnd: number, module: WasmParsedModule) {
    const sectionName = this.readString();
    module.customSections.push({
      name: sectionName,
      offset: payloadStart,
      sizeBytes: payloadEnd - payloadStart,
    });

    if (sectionName === 'name') {
      // Parse name section subsections
      while (this.offset < payloadEnd) {
        const subId = this.buffer[this.offset++];
        const subLength = this.readVarUint32();
        const subEnd = this.offset + subLength;

        if (subId === 1) { // Function names
          const nameCount = this.readVarUint32();
          for (let i = 0; i < nameCount; i++) {
            if (this.offset >= subEnd) break;
            const funcIdx = this.readVarUint32();
            const funcName = this.readString();
            module.functionNames.set(funcIdx, funcName);
          }
        }
        this.offset = subEnd;
      }
    }
  }

  private parseTypeSection(payloadEnd: number, module: WasmParsedModule) {
    const count = this.readVarUint32();
    for (let i = 0; i < count; i++) {
      if (this.offset >= payloadEnd) break;
      const form = this.buffer[this.offset++]; // 0x60 for func
      const paramCount = this.readVarUint32();
      const params: number[] = [];
      for (let p = 0; p < paramCount; p++) params.push(this.buffer[this.offset++]);
      const returnCount = this.readVarUint32();
      const returns: number[] = [];
      for (let r = 0; r < returnCount; r++) returns.push(this.buffer[this.offset++]);
      module.types.push({ form, params, returns });
    }
  }

  private parseImportSection(payloadEnd: number, module: WasmParsedModule): number {
    const count = this.readVarUint32();
    let importedFuncCount = 0;
    for (let i = 0; i < count; i++) {
      if (this.offset >= payloadEnd) break;
      const mod = this.readString();
      const field = this.readString();
      const kindByte = this.buffer[this.offset++];
      let kind: 'function' | 'table' | 'memory' | 'global' = 'function';
      let typeIndex: number | undefined;

      if (kindByte === 0) {
        kind = 'function';
        typeIndex = this.readVarUint32();
        module.imports.push({
          module: mod,
          field,
          kind,
          typeIndex,
          funcIndex: importedFuncCount,
        });
        importedFuncCount++;
      } else if (kindByte === 1) {
        kind = 'table';
        this.offset++; // elemtype
        this.readLimits();
        module.imports.push({ module: mod, field, kind });
      } else if (kindByte === 2) {
        kind = 'memory';
        const limits = this.readLimits();
        module.memories.push(limits);
        module.imports.push({ module: mod, field, kind });
      } else if (kindByte === 3) {
        kind = 'global';
        this.offset += 2; // content_type & mutability
        module.imports.push({ module: mod, field, kind });
      }
    }
    return importedFuncCount;
  }

  private parseFunctionSection(payloadEnd: number, module: WasmParsedModule) {
    const count = this.readVarUint32();
    for (let i = 0; i < count; i++) {
      if (this.offset >= payloadEnd) break;
      module.functions.push(this.readVarUint32());
    }
  }

  private parseMemorySection(payloadEnd: number, module: WasmParsedModule) {
    const count = this.readVarUint32();
    for (let i = 0; i < count; i++) {
      if (this.offset >= payloadEnd) break;
      module.memories.push(this.readLimits());
    }
  }

  private parseGlobalSection(payloadEnd: number, module: WasmParsedModule) {
    const count = this.readVarUint32();
    for (let i = 0; i < count; i++) {
      if (this.offset >= payloadEnd) break;
      const contentType = this.buffer[this.offset++];
      const mutability = this.buffer[this.offset++];
      const initExprOffset = this.offset;
      this.skipInitExpr();
      module.globals.push({ contentType, mutability, initExprOffset });
    }
  }

  private parseExportSection(payloadEnd: number, module: WasmParsedModule) {
    const count = this.readVarUint32();
    for (let i = 0; i < count; i++) {
      if (this.offset >= payloadEnd) break;
      const name = this.readString();
      const kindByte = this.buffer[this.offset++];
      const index = this.readVarUint32();
      const kinds: Array<'function' | 'table' | 'memory' | 'global'> = [
        'function',
        'table',
        'memory',
        'global',
      ];
      module.exports.push({ name, kind: kinds[kindByte] || 'function', index });
    }
  }

  private parseCodeSection(
    payloadStart: number,
    payloadEnd: number,
    module: WasmParsedModule,
    importedFuncCount: number
  ) {
    const count = this.readVarUint32();
    for (let i = 0; i < count; i++) {
      if (this.offset >= payloadEnd) break;
      const funcIndex = importedFuncCount + i;
      const bodySize = this.readVarUint32();
      const bodyOffset = this.offset;
      const bodyEnd = bodyOffset + bodySize;

      // Local declarations
      const localsCount = this.readVarUint32();
      for (let l = 0; l < localsCount; l++) {
        this.readVarUint32(); // count
        this.offset++; // type
      }

      const instructionsStart = this.offset;
      const instructions: WasmInstruction[] = [];

      while (this.offset < bodyEnd) {
        const instOffset = this.offset;
        const opcode = this.buffer[this.offset++];

        if (opcode === 0x0b) {
          // end of function
          instructions.push({ opcode, offset: instOffset });
          break;
        }

        const inst = this.parseInstruction(opcode, instOffset);
        instructions.push(inst);
      }

      module.codeBodies.push({
        funcIndex,
        typeIndex: module.functions[i] ?? 0,
        bodyOffset,
        bodySizeBytes: bodySize,
        instructionsStart,
        instructions,
      });

      this.offset = bodyEnd;
    }
  }

  private parseInstruction(opcode: number, instOffset: number): WasmInstruction {
    let immediate: any;

    switch (opcode) {
      case 0x10: // call
        immediate = { funcIndex: this.readVarUint32() };
        break;
      case 0x11: // call_indirect
        immediate = { typeIndex: this.readVarUint32(), tableIndex: this.readVarUint32() };
        break;
      case 0x20: // local.get
      case 0x21: // local.set
      case 0x22: // local.tee
      case 0x23: // global.get
      case 0x24: // global.set
        immediate = { index: this.readVarUint32() };
        break;
      case 0x40: // memory.grow
      case 0x3f: // memory.size
        immediate = { memIndex: this.readVarUint32() };
        break;
      // Memory load/store instructions
      case 0x28: // i32.load
      case 0x29: // i64.load
      case 0x2a: // f32.load
      case 0x2b: // f64.load
      case 0x2c: // i32.load8_s
      case 0x2d: // i32.load8_u
      case 0x2e: // i32.load16_s
      case 0x2f: // i32.load16_u
      case 0x30: // i64.load8_s
      case 0x31: // i64.load8_u
      case 0x32: // i64.load16_s
      case 0x33: // i64.load16_u
      case 0x34: // i64.load32_s
      case 0x35: // i64.load32_u
      case 0x36: // i32.store
      case 0x37: // i64.store
      case 0x38: // f32.store
      case 0x39: // f64.store
      case 0x3a: // i32.store8
      case 0x3b: // i32.store16
      case 0x3c: // i64.store8
      case 0x3d: // i64.store16
      case 0x3e: // i64.store32
        const align = this.readVarUint32();
        const offsetVal = this.readVarUint32();
        immediate = { align, offset: offsetVal };
        break;
      case 0x41: // i32.const
        immediate = { value: this.readVarInt32() };
        break;
      case 0x42: // i64.const
        immediate = { value: this.readVarInt32() }; // u64 approximated
        break;
      case 0x02: // block
      case 0x03: // loop
      case 0x04: // if
        this.offset++; // blocktype
        break;
      case 0x0c: // br
      case 0x0d: // br_if
        immediate = { relativeDepth: this.readVarUint32() };
        break;
      default:
        // Other single-byte opcodes
        break;
    }

    return { opcode, offset: instOffset, immediate };
  }

  private parseDataSection(payloadStart: number, payloadEnd: number, module: WasmParsedModule) {
    const count = this.readVarUint32();
    for (let i = 0; i < count; i++) {
      if (this.offset >= payloadEnd) break;
      const flags = this.readVarUint32();
      let memIndex = 0;
      let offsetVal = 0;

      if (flags === 0) {
        offsetVal = this.readInitExprConst();
      } else if (flags === 1) {
        // Passive segment
      } else if (flags === 2) {
        memIndex = this.readVarUint32();
        offsetVal = this.readInitExprConst();
      }

      const byteCount = this.readVarUint32();
      const segmentBytes = this.buffer.slice(this.offset, this.offset + byteCount);
      this.offset += byteCount;

      let preview: string | undefined;
      const textDecoder = new TextDecoder('utf-8', { fatal: false });
      const decoded = textDecoder.decode(segmentBytes);
      if (decoded && decoded.trim().length > 0) {
        preview = decoded.replace(/[^\x20-\x7E]/g, '.').slice(0, 64);
      }

      module.dataSegments.push({
        index: i,
        memoryIndex: memIndex,
        offset: offsetVal,
        sizeBytes: byteCount,
        preview,
      });
    }
  }

  private extractEmbeddedSourceLocations(module: WasmParsedModule) {
    const textDecoder = new TextDecoder('utf-8', { fatal: false });
    const fullText = textDecoder.decode(this.buffer);

    const lineRegex = /([a-zA-Z0-9_\-\/\\\.]+\.rs):(\d+)(?::(\d+))?/g;
    let match: RegExpExecArray | null;

    while ((match = lineRegex.exec(fullText)) !== null) {
      const file = match[1];
      const line = parseInt(match[2], 10);
      const column = match[3] ? parseInt(match[3], 10) : undefined;
      const matchPos = match.index;

      module.sourceLines.set(matchPos, {
        file,
        line,
        column,
      });
    }
  }

  private readLimits(): { min: number; max?: number } {
    const flags = this.buffer[this.offset++];
    const min = this.readVarUint32();
    let max: number | undefined;
    if ((flags & 0x01) !== 0) {
      max = this.readVarUint32();
    }
    return { min, max };
  }

  private skipInitExpr() {
    while (this.offset < this.buffer.length) {
      const b = this.buffer[this.offset++];
      if (b === 0x0b) break; // end opcode
    }
  }

  private readInitExprConst(): number {
    let val = 0;
    while (this.offset < this.buffer.length) {
      const b = this.buffer[this.offset++];
      if (b === 0x41) { // i32.const
        val = this.readVarInt32();
      } else if (b === 0x0b) {
        break;
      }
    }
    return val;
  }

  private readVarUint32(): number {
    let result = 0;
    let shift = 0;
    while (this.offset < this.buffer.length) {
      const byte = this.buffer[this.offset++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  }

  private readVarInt32(): number {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (this.offset >= this.buffer.length) break;
      byte = this.buffer[this.offset++];
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while ((byte & 0x80) !== 0);

    if (shift < 32 && (byte & 0x40) !== 0) {
      result |= ~0 << shift;
    }
    return result;
  }

  private readString(): string {
    const len = this.readVarUint32();
    const strBytes = this.buffer.slice(this.offset, this.offset + len);
    this.offset += len;
    return new TextDecoder('utf-8', { fatal: false }).decode(strBytes);
  }
}

export interface WasmInstruction {
  opcode: number;
  offset: number;
  immediate?: any;
}

export interface WasmCodeBody {
  funcIndex: number;
  typeIndex: number;
  bodyOffset: number;
  bodySizeBytes: number;
  instructionsStart: number;
  instructions: WasmInstruction[];
}

export interface WasmParsedModule {
  customSections: Array<{ name: string; offset: number; sizeBytes: number }>;
  types: Array<{ form: number; params: number[]; returns: number[] }>;
  imports: WasmImportInfo[];
  functions: number[]; // type indices
  memories: Array<{ min: number; max?: number }>;
  globals: Array<{ contentType: number; mutability: number; initExprOffset: number }>;
  exports: WasmExportInfo[];
  dataSegments: WasmDataSegment[];
  codeBodies: WasmCodeBody[];
  functionNames: Map<number, string>;
  sourceLines: Map<number, WasmSourceLocation>;
}

export class WasmInspector {
  private options: Required<WasmInspectorOptions>;

  constructor(options?: WasmInspectorOptions) {
    this.options = {
      maxAllowedMemoryPages: options?.maxAllowedMemoryPages ?? 1, // 1 WASM page = 64KB
      maxAllowedStaticDataSizeBytes: options?.maxAllowedStaticDataSizeBytes ?? 4096, // 4KB
      maxHostImportCallsPerFunction: options?.maxHostImportCallsPerFunction ?? 5,
      maxStackAllocationBytes: options?.maxStackAllocationBytes ?? 1024,
      warnOnDynamicMemoryGrow: options?.warnOnDynamicMemoryGrow ?? true,
      warnOnUnalignedMemoryAccess: options?.warnOnUnalignedMemoryAccess ?? true,
    };
  }

  public analyze(wasmBinary: Uint8Array | Buffer): WasmAnalysisResult {
    const parser = new WasmParser(wasmBinary);
    const module = parser.parse();

    const findings: WasmInefficiencyFinding[] = [];
    const memoryAllocations: WasmMemoryAllocation[] = [];
    const hostImportCallFrequency: Record<string, number> = {};

    // 1. Analyze Linear Memory Allocations
    for (const mem of module.memories) {
      const initialPages = mem.min;
      const maxPages = mem.max;
      const initialSizeBytes = initialPages * 65536;
      const maxSizeBytes = maxPages ? maxPages * 65536 : undefined;

      memoryAllocations.push({
        initialPages,
        maxPages,
        initialSizeBytes,
        maxSizeBytes,
      });

      if (initialPages > this.options.maxAllowedMemoryPages) {
        findings.push({
          id: 'SOROBAN_WASM_MEM_BLOAT',
          title: 'Excessive WASM Initial Memory Allocation',
          category: 'memory-bloat',
          severity: initialPages > 16 ? 'high' : 'medium',
          message: `WASM binary declares ${initialPages} initial memory pages (${initialSizeBytes} bytes / ${(initialSizeBytes / 1024).toFixed(1)} KB), exceeding the optimal baseline threshold of ${this.options.maxAllowedMemoryPages} page(s).`,
          suggestion:
            'Reduce initial stack/heap allocation in Cargo.toml or rustc flags (`-C link-arg=-zstack-size=...`). Use minimal static buffers.',
          binaryOffset: 0,
          metrics: {
            initialPages,
            initialSizeBytes,
            maxAllowedPages: this.options.maxAllowedMemoryPages,
          },
        });
      }
    }

    // 2. Analyze Static Data Segment Bloat
    let totalStaticDataSizeBytes = 0;
    for (const dataSeg of module.dataSegments) {
      totalStaticDataSizeBytes += dataSeg.sizeBytes;
    }

    if (totalStaticDataSizeBytes > this.options.maxAllowedStaticDataSizeBytes) {
      findings.push({
        id: 'SOROBAN_STATIC_DATA_BLOAT',
        title: 'Static Data Segment Bloat Detected',
        category: 'memory-bloat',
        severity: totalStaticDataSizeBytes > 16384 ? 'high' : 'medium',
        message: `Compiled WASM module contains ${module.dataSegments.length} static data segments totaling ${totalStaticDataSizeBytes} bytes (${(totalStaticDataSizeBytes / 1024).toFixed(2)} KB), exceeding the maximum recommended threshold of ${this.options.maxAllowedStaticDataSizeBytes} bytes.`,
        suggestion:
          'Remove unneeded panic message formatting, large string literals, or static array definitions. Use `#[no_std]` and strippanic abstractions where possible.',
        binaryOffset: module.dataSegments[0]?.offset ?? 0,
        metrics: {
          totalStaticDataSizeBytes,
          segmentCount: module.dataSegments.length,
          maxAllowedSizeBytes: this.options.maxAllowedStaticDataSizeBytes,
        },
      });
    }

    // Map imported functions by funcIndex
    const importedFuncMap = new Map<number, WasmImportInfo>();
    for (const imp of module.imports) {
      if (imp.kind === 'function' && imp.funcIndex !== undefined) {
        importedFuncMap.set(imp.funcIndex, imp);
        const key = `${imp.module}.${imp.field}`;
        hostImportCallFrequency[key] = 0;
      }
    }

    // 3. Analyze Function Bodies for Inefficiencies
    const functionAnalyses: WasmFunctionAnalysis[] = [];

    for (const codeBody of module.codeBodies) {
      let hostCallCount = 0;
      let memoryGrowCount = 0;
      let unalignedAccessCount = 0;
      let maxStackFrameBytes = 0;

      const funcName =
        module.functionNames.get(codeBody.funcIndex) ||
        this.findExportName(module, codeBody.funcIndex) ||
        `func_${codeBody.funcIndex}`;

      const funcSourceLoc = this.findClosestSourceLocation(module, codeBody.bodyOffset);

      for (let instIdx = 0; instIdx < codeBody.instructions.length; instIdx++) {
        const inst = codeBody.instructions[instIdx];

        // Check Call instructions to Host Imports
        if (inst.opcode === 0x10 && inst.immediate?.funcIndex !== undefined) {
          const targetIndex = inst.immediate.funcIndex;
          const hostImp = importedFuncMap.get(targetIndex);
          if (hostImp) {
            hostCallCount++;
            const key = `${hostImp.module}.${hostImp.field}`;
            hostImportCallFrequency[key] = (hostImportCallFrequency[key] || 0) + 1;
          }
        }

        // Check Dynamic Memory Growth (`memory.grow`)
        if (inst.opcode === 0x40 && this.options.warnOnDynamicMemoryGrow) {
          memoryGrowCount++;
          findings.push({
            id: 'SOROBAN_DYNAMIC_MEMORY_GROW',
            title: 'Unoptimized Dynamic Memory Allocation (memory.grow)',
            category: 'allocator-overhead',
            severity: 'high',
            message: `Function '${funcName}' invokes WASM 'memory.grow' instruction at binary offset 0x${inst.offset.toString(16)}. Soroban contract execution penalizes dynamic heap growth.`,
            suggestion:
              'Avoid dynamic heap growth during runtime. Pre-allocate required structures or use fixed-size stack buffers.',
            binaryOffset: inst.offset,
            sourceLocation: funcSourceLoc
              ? { ...funcSourceLoc, functionName: funcName }
              : undefined,
            metrics: { funcIndex: codeBody.funcIndex, functionName: funcName },
          });
        }

        // Check Stack Pointer Adjustments (detect large stack frames)
        if (inst.opcode === 0x41 && inst.immediate?.value !== undefined) {
          const constVal = Math.abs(inst.immediate.value);
          const nextInst = codeBody.instructions[instIdx + 1];
          if (nextInst && (nextInst.opcode === 0x6b || nextInst.opcode === 0x24)) {
            if (constVal > maxStackFrameBytes) {
              maxStackFrameBytes = constVal;
            }
          }
        }

        // Check Unaligned Memory Loads / Stores
        if (
          (inst.opcode >= 0x28 && inst.opcode <= 0x3e) &&
          this.options.warnOnUnalignedMemoryAccess
        ) {
          const align = inst.immediate?.align ?? 0;
          const naturalAlign = this.getNaturalAlignment(inst.opcode);
          if (align < naturalAlign) {
            unalignedAccessCount++;
          }
        }
      }

      // Flag High Host Import Call Frequency per function
      if (hostCallCount > this.options.maxHostImportCallsPerFunction) {
        findings.push({
          id: 'SOROBAN_HOST_IMPORT_FREQUENCY',
          title: 'High Host Import Call Frequency',
          category: 'host-import-frequency',
          severity: 'medium',
          message: `Function '${funcName}' performs ${hostCallCount} host environment import calls, exceeding the threshold of ${this.options.maxHostImportCallsPerFunction}. Frequent host context switching increases CPU gas costs.`,
          suggestion:
            'Batch host environment calls or cache host object handles locally inside WASM execution frame.',
          binaryOffset: codeBody.bodyOffset,
          sourceLocation: funcSourceLoc
            ? { ...funcSourceLoc, functionName: funcName }
            : undefined,
          metrics: {
            funcIndex: codeBody.funcIndex,
            functionName: funcName,
            hostCallCount,
            threshold: this.options.maxHostImportCallsPerFunction,
          },
        });
      }

      // Flag Large Stack Frame Allocations
      if (maxStackFrameBytes > this.options.maxStackAllocationBytes) {
        findings.push({
          id: 'SOROBAN_LARGE_STACK_ALLOCATION',
          title: 'Excessive Stack Frame Allocation',
          category: 'stack-bloat',
          severity: 'medium',
          message: `Function '${funcName}' allocates ${maxStackFrameBytes} bytes on the WASM stack frame, exceeding the recommended max of ${this.options.maxStackAllocationBytes} bytes.`,
          suggestion:
            'Pass large structs by reference or refactor local buffers to avoid deep stack allocation overhead.',
          binaryOffset: codeBody.bodyOffset,
          sourceLocation: funcSourceLoc
            ? { ...funcSourceLoc, functionName: funcName }
            : undefined,
          metrics: {
            funcIndex: codeBody.funcIndex,
            functionName: funcName,
            stackBytes: maxStackFrameBytes,
          },
        });
      }

      // Flag Unaligned Memory Accesses
      if (unalignedAccessCount > 0) {
        findings.push({
          id: 'SOROBAN_UNALIGNED_MEMORY_ACCESS',
          title: 'Unaligned Memory Access Instructions',
          category: 'unaligned-memory',
          severity: 'low',
          message: `Function '${funcName}' contains ${unalignedAccessCount} unaligned memory load/store instruction(s).`,
          suggestion:
            'Ensure memory data structures align with natural byte boundaries (4-byte for i32, 8-byte for i64) to prevent CPU alignment penalty.',
          binaryOffset: codeBody.bodyOffset,
          sourceLocation: funcSourceLoc
            ? { ...funcSourceLoc, functionName: funcName }
            : undefined,
          metrics: {
            funcIndex: codeBody.funcIndex,
            functionName: funcName,
            unalignedAccessCount,
          },
        });
      }

      functionAnalyses.push({
        funcIndex: codeBody.funcIndex,
        name: funcName,
        typeIndex: codeBody.typeIndex,
        bodyOffset: codeBody.bodyOffset,
        bodySizeBytes: codeBody.bodySizeBytes,
        instructionCount: codeBody.instructions.length,
        hostCallCount,
        memoryGrowCount,
        maxStackFrameBytes,
        unalignedAccessCount,
      });
    }

    return {
      binarySizeBytes: wasmBinary.length,
      memoryAllocations,
      totalStaticDataSizeBytes,
      dataSegments: module.dataSegments,
      importedFunctionsCount: module.imports.filter((i) => i.kind === 'function').length,
      definedFunctionsCount: module.codeBodies.length,
      imports: module.imports,
      exports: module.exports,
      hostImportCallFrequency,
      functionAnalyses,
      findings,
      sourceMappingAvailable: module.sourceLines.size > 0 || module.functionNames.size > 0,
    };
  }

  private findExportName(module: WasmParsedModule, funcIndex: number): string | undefined {
    const exp = module.exports.find((e) => e.kind === 'function' && e.index === funcIndex);
    return exp?.name;
  }

  private findClosestSourceLocation(
    module: WasmParsedModule,
    offset: number
  ): WasmSourceLocation | undefined {
    let closestLoc: WasmSourceLocation | undefined;
    let minDistance = Infinity;

    for (const [pos, loc] of module.sourceLines.entries()) {
      const dist = Math.abs(pos - offset);
      if (dist < minDistance) {
        minDistance = dist;
        closestLoc = loc;
      }
    }
    return closestLoc;
  }

  private getNaturalAlignment(opcode: number): number {
    switch (opcode) {
      case 0x28: // i32.load
      case 0x2a: // f32.load
      case 0x36: // i32.store
      case 0x38: // f32.store
      case 0x34: // i64.load32_s
      case 0x35: // i64.load32_u
      case 0x3e: // i64.store32
        return 2; // 2^2 = 4 bytes alignment
      case 0x29: // i64.load
      case 0x2b: // f64.load
      case 0x37: // i64.store
      case 0x39: // f64.store
        return 3; // 2^3 = 8 bytes alignment
      case 0x2e: // i32.load16_s
      case 0x2f: // i32.load16_u
      case 0x32: // i64.load16_s
      case 0x33: // i64.load16_u
      case 0x3b: // i32.store16
      case 0x3d: // i64.store16
        return 1; // 2^1 = 2 bytes alignment
      default:
        return 0; // 1 byte alignment
    }
  }
}
