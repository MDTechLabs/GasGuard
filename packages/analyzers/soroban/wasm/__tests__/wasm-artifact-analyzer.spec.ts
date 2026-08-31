import {
  analyzeWasmArtifact,
  inspectWasmArtifact,
  isDebugCustomSection,
} from '../wasm-artifact-analyzer';

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

function encVarUint(value: number): number[] {
  const bytes: number[] = [];
  let val = value >>> 0;
  while (val >= 0x80) {
    bytes.push((val & 0x7f) | 0x80);
    val >>>= 7;
  }
  bytes.push(val & 0x7f);
  return bytes;
}

function encStr(s: string): number[] {
  const body = Array.from(Buffer.from(s, 'utf-8'));
  return [...encVarUint(body.length), ...body];
}

/** Build a section: [sectionId, leb(payloadLen), ...payload]. */
function section(id: number, payload: number[]): number[] {
  return [id, ...encVarUint(payload.length), ...payload];
}

function customSection(name: string, payload: number[] = []): number[] {
  return section(0, [...encStr(name), ...payload]);
}

function emptyDataSection(): number[] {
  // count=1; flags=0; init expr i32.const 0 + end; byteCount=4
  return section(11, [0x01, 0x00, 0x41, 0x00, 0x0b, 0x04]);
}

function memorySection(pages = 1): number[] {
  // count=1; flags=0 (no max); min=pages
  return section(5, [0x01, 0x00, pages]);
}

function exportSection(name: string): number[] {
  // count=1; name; kind=function(0); index=0
  return section(7, [0x01, ...encStr(name), 0x00, 0x00]);
}

function buildWasm(chunks: number[][]): Uint8Array {
  const body: number[] = [];
  for (const c of chunks) body.push(...c);
  return new Uint8Array([...HEADER, ...body]);
}

describe('WasmArtifactAnalyzer (#929)', () => {
  it('recognizes debug custom sections', () => {
    expect(isDebugCustomSection('.debug_info')).toBe(true);
    expect(isDebugCustomSection('sourceMappingURL')).toBe(true);
    expect(isDebugCustomSection('producers')).toBe(false);
    expect(isDebugCustomSection('name')).toBe(false);
  });

  it('inspects artifact size and section metadata', () => {
    const wasm = buildWasm([customSection('.debug_info', [1, 2, 3])]);
    const meta = inspectWasmArtifact(wasm);
    expect(meta.binarySizeBytes).toBe(wasm.byteLength);
    expect(meta.hasDebugInfo).toBe(true);
    expect(meta.debugCustomSections).toContain('.debug_info');
  });

  it('flags retained debug info and unstripped name sections', () => {
    const wasm = buildWasm([
      customSection('.debug_str', []),
      customSection('name', []),
      exportSection('__wasm_export_hello'),
    ]);
    const analysis = analyzeWasmArtifact(wasm);
    const ids = analysis.findings.map((f) => f.ruleId);
    expect(ids).toContain('soroban-wasm-debug-info');
    expect(ids).toContain('soroban-wasm-unstripped');
    expect(analysis.metadata.hasNameSection).toBe(true);
  });

  it('reports an abnormal verdict when nothing is exported', () => {
    const wasm = buildWasm([customSection('producers', [])]);
    const analysis = analyzeWasmArtifact(wasm);
    expect(analysis.findings.some((f) => f.ruleId === 'soroban-wasm-no-exports')).toBe(true);
    expect(analysis.verdict).toBe('abnormal');
  });

  it('considers a minimal clean artifact optimised', () => {
    const wasm = buildWasm([memorySection(1), exportSection('hello')]);
    const analysis = analyzeWasmArtifact(wasm);
    expect(analysis.metadata.memoryCount).toBe(1);
    expect(analysis.metadata.exportNames).toContain('hello');
    expect(analysis.findings.some((f) => f.ruleId === 'soroban-wasm-no-exports')).toBe(false);
    expect(analysis.verdict).toBe('optimized');
  });

  it('reads data segment count', () => {
    const wasm = buildWasm([emptyDataSection(), exportSection('hello')]);
    const meta = inspectWasmArtifact(wasm);
    expect(meta.dataSegments).toBe(1);
  });
});