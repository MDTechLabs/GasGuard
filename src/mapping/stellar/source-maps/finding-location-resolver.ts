/**
 * Source-map-aware finding locations (#1171).
 *
 * Findings raised against generated output (bundles, transpiled contracts) point
 * at the generated file. This resolver decodes the standard source-map
 * `mappings` field and maps a generated position back to the original source,
 * so a finding is reported where the author wrote the code.
 *
 * Only the v3 `mappings` field is decoded — no network access, no dependency on
 * the source map library — and `sourcesContent` is never read or returned.
 */

export interface RawSourceMap {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  names?: string[];
  mappings: string;
}

/** Generated position as stored in source maps: line and column are 0-based. */
export interface GeneratedPosition {
  line: number;
  column: number;
}

/** Resolved location in the original source: line and column are 1-based. */
export interface ResolvedLocation {
  file: string;
  line: number;
  column: number;
  name?: string;
}

export interface MappingSegment {
  generatedColumn: number;
  sourceIndex: number;
  sourceLine: number;
  sourceColumn: number;
  nameIndex?: number;
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const BASE64_VALUES = new Map<string, number>(
  [...BASE64_ALPHABET].map((character, index) => [character, index]),
);

export class SourceMapDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceMapDecodeError";
  }
}

/** Decode one VLQ value list into signed integers. */
export function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let shift = 0;
  let value = 0;

  for (const character of segment) {
    const digit = BASE64_VALUES.get(character);
    if (digit === undefined) {
      throw new SourceMapDecodeError(`invalid base64 character: ${character}`);
    }

    const continuation = (digit & 32) !== 0;
    value += (digit & 31) << shift;

    if (continuation) {
      shift += 5;
      continue;
    }

    const negative = (value & 1) === 1;
    value >>>= 1;
    values.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }

  if (shift !== 0) {
    throw new SourceMapDecodeError("truncated VLQ segment");
  }

  return values;
}

/** Decode a `mappings` string into one segment list per generated line. */
export function decodeMappings(mappings: string): MappingSegment[][] {
  if (typeof mappings !== "string") {
    throw new SourceMapDecodeError("mappings must be a string");
  }

  const lines: MappingSegment[][] = [];
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;

  for (const line of mappings.split(";")) {
    const segments: MappingSegment[] = [];
    let generatedColumn = 0;

    for (const rawSegment of line.split(",")) {
      if (rawSegment === "") {
        continue;
      }

      const values = decodeVlq(rawSegment);
      generatedColumn += values[0] ?? 0;

      if (values.length === 1) {
        segments.push({
          generatedColumn,
          sourceIndex,
          sourceLine,
          sourceColumn,
        });
        continue;
      }

      sourceIndex += values[1] ?? 0;
      sourceLine += values[2] ?? 0;
      sourceColumn += values[3] ?? 0;

      const segment: MappingSegment = {
        generatedColumn,
        sourceIndex,
        sourceLine,
        sourceColumn,
      };

      if (values.length > 4) {
        nameIndex += values[4];
        segment.nameIndex = nameIndex;
      }

      segments.push(segment);
    }

    lines.push(segments);
  }

  return lines;
}

/**
 * Map a generated position back to its original location.
 *
 * Returns undefined when the position has no mapping, which callers should
 * treat as "report the generated location unchanged".
 */
export function resolveGeneratedPosition(
  map: RawSourceMap,
  position: GeneratedPosition,
): ResolvedLocation | undefined {
  if (!map || !Array.isArray(map.sources)) {
    throw new SourceMapDecodeError("source map must declare a sources array");
  }

  const lines = decodeMappings(map.mappings);
  const segments = lines[position.line];
  if (!segments || segments.length === 0) {
    return undefined;
  }

  const segment = findNearestSegment(segments, position.column);
  if (!segment) {
    return undefined;
  }

  const source = map.sources[segment.sourceIndex];
  if (source === undefined) {
    return undefined;
  }

  const name =
    segment.nameIndex === undefined ? undefined : map.names?.[segment.nameIndex];

  return {
    file: joinSourceRoot(map.sourceRoot, source),
    line: segment.sourceLine + 1,
    column: segment.sourceColumn + 1,
    ...(name ? { name } : {}),
  };
}

/**
 * Map a finding reported with a 1-based line number.
 */
export function resolveFindingLocation(
  map: RawSourceMap,
  findingLine: number,
  generatedColumn = 0,
): ResolvedLocation | undefined {
  if (!Number.isInteger(findingLine) || findingLine < 1) {
    throw new RangeError("findingLine must be a positive integer");
  }
  return resolveGeneratedPosition(map, {
    line: findingLine - 1,
    column: generatedColumn,
  });
}

function findNearestSegment(
  segments: readonly MappingSegment[],
  column: number,
): MappingSegment | undefined {
  let candidate: MappingSegment | undefined;
  for (const segment of segments) {
    if (segment.generatedColumn > column) {
      break;
    }
    candidate = segment;
  }
  return candidate ?? segments[0];
}

function joinSourceRoot(sourceRoot: string | undefined, source: string): string {
  if (!sourceRoot) {
    return source;
  }
  return `${sourceRoot.replace(/\/+$/, "")}/${source.replace(/^\/+/, "")}`;
}
