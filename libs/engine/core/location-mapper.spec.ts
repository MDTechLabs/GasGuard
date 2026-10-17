import * as fs from "fs";
import * as path from "path";
import {
  buildFileLineIndex,
  createLocationAnchor,
  isLocationAnchor,
  mapLocation,
} from "./location-mapper";

const FIXTURES = path.resolve(__dirname, "../../../tests/fixtures/location-mapping");
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

const v1 = read("runner.v1.ts");
const v2 = read("runner.v2.ts");
const v3 = read("runner.v3.ts");
const v4 = read("runner.v4-rewritten.ts");

/** 1-based line number of the nth (0-based) line whose trimmed text equals `text`. */
function lineOf(content: string, text: string, nth = 0): number {
  const hits = content
    .split("\n")
    .map((l, i) => ({ l: l.trim(), n: i + 1 }))
    .filter((x) => x.l === text);
  return hits[nth].n;
}

describe("createLocationAnchor", () => {
  it("captures hashes and non-blank context, ignoring blank lines", () => {
    const a = createLocationAnchor(v1, { startLine: 9 })!;
    expect(isLocationAnchor(a)).toBe(true);
    expect(a.startLine).toBe(9);
    expect(a.endLine).toBe(9);
    expect(a.before).toHaveLength(3);
    expect(a.after).toHaveLength(3);
  });

  it("returns undefined for lines outside the file or invalid spans", () => {
    expect(createLocationAnchor(v1, { startLine: 999 })).toBeUndefined();
    expect(createLocationAnchor(v1, { startLine: 0 })).toBeUndefined();
    expect(createLocationAnchor(v1, { startLine: Number.NaN })).toBeUndefined();
    expect(createLocationAnchor(undefined as unknown as string, { startLine: 1 })).toBeUndefined();
  });

  it("clamps an overlong or inverted span", () => {
    expect(createLocationAnchor(v1, { startLine: 9, endLine: 2 })!.endLine).toBe(9);
    expect(createLocationAnchor(v1, { startLine: 9, endLine: 9999 })!.endLine).toBe(15);
  });

  it("is deterministic and rejects malformed anchors", () => {
    expect(createLocationAnchor(v1, { startLine: 9 })).toEqual(createLocationAnchor(v1, { startLine: 9 }));
    expect(isLocationAnchor({ version: 99 })).toBe(false);
    expect(isLocationAnchor(null)).toBe(false);
  });
});

describe("mapLocation — realistic repository revisions", () => {
  const lookupAnchor = createLocationAnchor(v1, { startLine: 9 })!;
  const tailAnchor = createLocationAnchor(v1, { startLine: 14 })!;

  it("reports exact for an unchanged file", () => {
    const m = mapLocation(lookupAnchor, v1);
    expect(m).toMatchObject({ status: "exact", startLine: 9, delta: 0, confidence: 1 });
  });

  it("follows each finding through inserted code, not to the look-alike line", () => {
    const lookup = mapLocation(lookupAnchor, v2);
    const tail = mapLocation(tailAnchor, v2);
    expect(lookup.status).toBe("moved");
    expect(lookup.startLine).toBe(lineOf(v2, "return exec(cmd);", 0));
    expect(tail.status).toBe("moved");
    expect(tail.startLine).toBe(lineOf(v2, "return exec(cmd);", 1));
    expect(lookup.delta).toBe(lookup.startLine - 9);
  });

  it("finds an edited line from its unchanged surroundings and never jumps to the identical line", () => {
    const m = mapLocation(lookupAnchor, v3);
    expect(m.status).toBe("modified");
    expect(m.startLine).toBe(9);
    // the unedited sibling still maps exactly
    expect(mapLocation(tailAnchor, v3)).toMatchObject({ status: "exact", startLine: 14 });
  });

  it("reports lost, keeping the last known location, when the code is gone", () => {
    expect(mapLocation(lookupAnchor, v4)).toEqual({
      status: "lost",
      startLine: 9,
      endLine: 9,
      confidence: 0,
      delta: 0,
    });
  });

  it("is stable across line endings and indentation changes", () => {
    const crlf = v2.replace(/\n/g, "\r\n");
    const reindented = v2.replace(/^ {2}/gm, "\t");
    const expected = mapLocation(lookupAnchor, v2);
    expect(mapLocation(lookupAnchor, crlf)).toEqual(expected);
    expect(mapLocation(lookupAnchor, reindented)).toEqual(expected);
  });

  it("is chainable: re-anchoring after each move keeps the mapping exact", () => {
    const m2 = mapLocation(lookupAnchor, v2);
    const reanchored = createLocationAnchor(v2, { startLine: m2.startLine })!;
    expect(mapLocation(reanchored, v2)).toMatchObject({ status: "exact", startLine: m2.startLine });
  });

  it("gives identical results from a string and a prebuilt index", () => {
    expect(mapLocation(lookupAnchor, buildFileLineIndex(v2))).toEqual(mapLocation(lookupAnchor, v2));
  });
});

describe("mapLocation — multi-line spans", () => {
  it("preserves span length when the block moves", () => {
    const anchor = createLocationAnchor(v1, { startLine: 8, endLine: 9 })!;
    const m = mapLocation(anchor, v2);
    expect(m.status).toBe("moved");
    expect(m.endLine - m.startLine).toBe(1);
    expect(m.startLine).toBe(lineOf(v2, "const cmd = `nslookup ${name}`;"));
  });
});

describe("mapLocation — ambiguity and failure semantics", () => {
  it("flags ambiguous when identical blocks tie, choosing the closest then lowest line", () => {
    const anchor = createLocationAnchor("a\nX\nb", { startLine: 2 })!;
    const m = mapLocation(anchor, "c\na\nX\nb\nd\na\nX\nb");
    expect(m.status).toBe("ambiguous");
    expect(m.startLine).toBe(3);
  });

  it("prefers the original line when copies tie", () => {
    const anchor = createLocationAnchor("a\nX\nb", { startLine: 2 })!;
    expect(mapLocation(anchor, "a\nX\nb\n\na\nX\nb").status).toBe("exact");
  });

  it("does not guess when only the line text survives with different context", () => {
    const anchor = createLocationAnchor("a\nb\nTARGET\nc\nd", { startLine: 3 })!;
    expect(mapLocation(anchor, "w\nx\nTARGET\ny\nz\n").status).toBe("lost");
  });

  it("lets callers loosen the threshold", () => {
    const anchor = createLocationAnchor("a\nb\nTARGET\nc\nd", { startLine: 3 })!;
    expect(mapLocation(anchor, "w\nx\nTARGET\ny\nz\n", { minConfidence: 0.5 }).status).toBe("exact");
  });

  it("treats blank anchors as trustworthy only at their original position", () => {
    const anchor = createLocationAnchor("a\n\nb", { startLine: 2 })!;
    expect(mapLocation(anchor, "a\n\nb").status).toBe("exact");
    expect(mapLocation(anchor, "x\na\n\nb").status).toBe("lost");
  });

  it("never throws on bad input", () => {
    const anchor = createLocationAnchor(v1, { startLine: 9 })!;
    expect(mapLocation(anchor, "").status).toBe("lost");
    expect(mapLocation(anchor, undefined as unknown as string).status).toBe("lost");
    expect(mapLocation({} as never, v1).status).toBe("lost");
  });

  it("is deterministic for repeated calls", () => {
    const anchor = createLocationAnchor(v1, { startLine: 9 })!;
    expect(mapLocation(anchor, v2)).toEqual(mapLocation(anchor, v2));
  });
});
