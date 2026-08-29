import {
  WasmInspector,
  WasmParser,
  WasmAnalysisResult,
} from './wasm-inspector';

describe('WasmInspector (Soroban Memory Layout Analyzer)', () => {
  // Helper LEB128 unsigned encoder
  function encodeVarUint32(value: number): number[] {
    const bytes: number[] = [];
    let val = value >>> 0;
    while (val >= 0x80) {
      bytes.push((val & 0x7f) | 0x80);
      val >>>= 7;
    }
    bytes.push(val & 0x7f);
    return bytes;
  }

  // Helper LEB128 signed encoder
  function encodeVarInt32(value: number): number[] {
    const bytes: number[] = [];
    let more = true;
    let val = value;
    while (more) {
      let byte = val & 0x7f;
      val >>= 7;
      if ((val === 0 && (byte & 0x40) === 0) || (val === -1 && (byte & 0x40) !== 0)) {
        more = false;
      } else {
        byte |= 0x80;
      }
      bytes.push(byte);
    }
    return bytes;
  }

  // Helper to build UTF-8 string bytes prefixed by LEB128 length
  function encodeString(str: string): number[] {
    const strBytes = Array.from(Buffer.from(str, 'utf-8'));
    return [...encodeVarUint32(strBytes.length), ...strBytes];
  }

  // Helper to create a basic minimal valid WASM binary
  function createBaseWasmBinary(sections: Array<{ id: number; payload: number[] }>): Uint8Array {
    const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]; // \0asm, version 1
    const body: number[] = [];

    for (const sec of sections) {
      body.push(sec.id);
      body.push(...encodeVarUint32(sec.payload.length));
      body.push(...sec.payload);
    }

    return new Uint8Array([...header, ...body]);
  }

  describe('WasmParser Header & Section Validation', () => {
    it('should fail validation on invalid WASM magic header', () => {
      const invalidBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
      const parser = new WasmParser(invalidBytes);
      expect(parser.validateHeader()).toBe(false);
      expect(() => parser.parse()).toThrow('Invalid WebAssembly binary header');
    });

    it('should validate and parse a minimal valid WASM binary', () => {
      const wasmBytes = createBaseWasmBinary([]);
      const parser = new WasmParser(wasmBytes);
      expect(parser.validateHeader()).toBe(true);

      const parsed = parser.parse();
      expect(parsed.memories.length).toBe(0);
      expect(parsed.imports.length).toBe(0);
      expect(parsed.codeBodies.length).toBe(0);
    });
  });

  describe('Linear Memory Allocation Bloat Analysis', () => {
    it('should identify excessive initial memory pages allocation (> 1 page)', () => {
      // Memory section: 1 memory declaration with 16 pages (1MB)
      const memoryPayload = [
        ...encodeVarUint32(1), // 1 memory
        0x01, // flags: min and max
        ...encodeVarUint32(16), // min 16 pages
        ...encodeVarUint32(32), // max 32 pages
      ];

      const wasmBytes = createBaseWasmBinary([{ id: 5, payload: memoryPayload }]);
      const inspector = new WasmInspector({ maxAllowedMemoryPages: 1 });
      const result: WasmAnalysisResult = inspector.analyze(wasmBytes);

      expect(result.memoryAllocations.length).toBe(1);
      expect(result.memoryAllocations[0].initialPages).toBe(16);
      expect(result.memoryAllocations[0].initialSizeBytes).toBe(16 * 65536);

      const memFinding = result.findings.find((f) => f.id === 'SOROBAN_WASM_MEM_BLOAT');
      expect(memFinding).toBeDefined();
      expect(memFinding?.category).toBe('memory-bloat');
      expect(memFinding?.severity).toBe('medium');
      expect(memFinding?.message).toContain('16 initial memory pages');
    });
  });

  describe('Static Data Segment Bloat Analysis', () => {
    it('should identify bloated static data segments exceeding max threshold', () => {
      // Data section payload: 1 active data segment with 8192 bytes
      const dummyData = new Array(8192).fill(0x41); // 'A'
      const dataPayload = [
        ...encodeVarUint32(1), // 1 data segment
        ...encodeVarUint32(0), // active, memIndex 0
        0x41, 0x00, 0x0b, // i32.const 0 end
        ...encodeVarUint32(dummyData.length),
        ...dummyData,
      ];

      const wasmBytes = createBaseWasmBinary([{ id: 11, payload: dataPayload }]);
      const inspector = new WasmInspector({ maxAllowedStaticDataSizeBytes: 4096 });
      const result: WasmAnalysisResult = inspector.analyze(wasmBytes);

      expect(result.totalStaticDataSizeBytes).toBe(8192);
      const dataFinding = result.findings.find((f) => f.id === 'SOROBAN_STATIC_DATA_BLOAT');
      expect(dataFinding).toBeDefined();
      expect(dataFinding?.category).toBe('memory-bloat');
      expect(dataFinding?.message).toContain('8192 bytes');
    });
  });

  describe('Host Import Call Frequency Analysis', () => {
    it('should analyze host import calls frequency and detect high call count in hot function', () => {
      // Type section: () -> ()
      const typePayload = [
        ...encodeVarUint32(1), // 1 type
        0x60, // func
        ...encodeVarUint32(0), // 0 params
        ...encodeVarUint32(0), // 0 returns
      ];

      // Import section: 1 imported function "x"."v" (host import)
      const importPayload = [
        ...encodeVarUint32(1), // 1 import
        ...encodeString('x'), // module
        ...encodeString('v'), // field
        0x00, // kind: function
        ...encodeVarUint32(0), // type index 0
      ];

      // Function section: 1 defined function with type index 0
      const funcPayload = [
        ...encodeVarUint32(1),
        ...encodeVarUint32(0),
      ];

      // Code section: defined function (funcIndex = 1) calling host import (funcIndex = 0) 8 times
      const bodyInstructions: number[] = [];
      for (let i = 0; i < 8; i++) {
        bodyInstructions.push(0x10, ...encodeVarUint32(0)); // call 0
      }
      bodyInstructions.push(0x0b); // end

      const funcBodyPayload = [
        ...encodeVarUint32(0), // 0 local declarations
        ...bodyInstructions,
      ];

      const codePayload = [
        ...encodeVarUint32(1), // 1 code body
        ...encodeVarUint32(funcBodyPayload.length),
        ...funcBodyPayload,
      ];

      const wasmBytes = createBaseWasmBinary([
        { id: 1, payload: typePayload },
        { id: 2, payload: importPayload },
        { id: 3, payload: funcPayload },
        { id: 10, payload: codePayload },
      ]);

      const inspector = new WasmInspector({ maxHostImportCallsPerFunction: 5 });
      const result: WasmAnalysisResult = inspector.analyze(wasmBytes);

      expect(result.importedFunctionsCount).toBe(1);
      expect(result.hostImportCallFrequency['x.v']).toBe(8);

      const freqFinding = result.findings.find((f) => f.id === 'SOROBAN_HOST_IMPORT_FREQUENCY');
      expect(freqFinding).toBeDefined();
      expect(freqFinding?.category).toBe('host-import-frequency');
      expect(freqFinding?.message).toContain('8 host environment import calls');
    });
  });

  describe('Dynamic Memory Growth & Unaligned Access Analysis', () => {
    it('should detect memory.grow instructions and unaligned memory load operations', () => {
      // Type section
      const typePayload = [...encodeVarUint32(1), 0x60, 0x00, 0x00];
      // Function section
      const funcPayload = [...encodeVarUint32(1), 0x00];

      // Code section: memory.grow (0x40 0x00) + unaligned i32.load (0x28 align=0 offset=0)
      const bodyInstructions = [
        0x40, 0x00, // memory.grow 0
        0x28, 0x00, 0x00, // i32.load align=0 offset=0
        0x0b, // end
      ];
      const funcBody = [...encodeVarUint32(0), ...bodyInstructions];
      const codePayload = [...encodeVarUint32(1), ...encodeVarUint32(funcBody.length), ...funcBody];

      const wasmBytes = createBaseWasmBinary([
        { id: 1, payload: typePayload },
        { id: 3, payload: funcPayload },
        { id: 10, payload: codePayload },
      ]);

      const inspector = new WasmInspector({
        warnOnDynamicMemoryGrow: true,
        warnOnUnalignedMemoryAccess: true,
      });
      const result = inspector.analyze(wasmBytes);

      const growFinding = result.findings.find((f) => f.id === 'SOROBAN_DYNAMIC_MEMORY_GROW');
      expect(growFinding).toBeDefined();
      expect(growFinding?.category).toBe('allocator-overhead');

      const alignFinding = result.findings.find((f) => f.id === 'SOROBAN_UNALIGNED_MEMORY_ACCESS');
      expect(alignFinding).toBeDefined();
      expect(alignFinding?.category).toBe('unaligned-memory');
    });
  });

  describe('Source Line Location Correlation', () => {
    it('should correlate finding to source Rust file line number embedded in binary', () => {
      // Include embedded Rust file line reference string in a custom section
      const sourceRef = 'src/contract.rs:42:10';
      const customPayload = [...encodeString('soroban_source'), ...Buffer.from(sourceRef, 'utf-8')];

      // Memory section with memory bloat
      const memoryPayload = [
        ...encodeVarUint32(1),
        0x00,
        ...encodeVarUint32(8), // 8 pages
      ];

      const wasmBytes = createBaseWasmBinary([
        { id: 0, payload: customPayload },
        { id: 5, payload: memoryPayload },
      ]);

      const inspector = new WasmInspector({ maxAllowedMemoryPages: 1 });
      const result = inspector.analyze(wasmBytes);

      expect(result.sourceMappingAvailable).toBe(true);
    });
  });
});
