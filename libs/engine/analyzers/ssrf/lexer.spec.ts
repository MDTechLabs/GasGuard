import { LineIndex, maskComments, maskStringContents, readCallArgs } from "./lexer";

describe("ssrf lexer", () => {
  describe("maskComments", () => {
    it("masks JS single-line comments", () => {
      const src = "const x = 1; // comment\nconst y = 2;";
      const masked = maskComments(src);
      expect(masked.length).toBe(src.length);
      expect(masked).not.toContain("// comment");
      expect(masked).toContain("const x = 1;");
      expect(masked).toContain("const y = 2;");
    });

    it("masks JS block comments", () => {
      const src = "/* line 1\nline 2 */const a = 1;";
      const masked = maskComments(src);
      expect(masked.length).toBe(src.length);
      expect(masked.includes("/*")).toBe(false);
      expect(masked.includes("const a = 1;")).toBe(true);
    });

    it("masks Python # comments", () => {
      const src = "url = req.url # get url\nrequests.get(url)";
      const masked = maskComments(src);
      expect(masked.length).toBe(src.length);
      expect(masked.includes("# get url")).toBe(false);
      expect(masked.includes("requests.get(url)")).toBe(true);
    });
  });

  describe("readCallArgs", () => {
    it("extracts multiple nested arguments", () => {
      const src = 'fetch(req.query.url, { method: "POST", headers: { a: 1 } })';
      const openParen = src.indexOf("(") + 1;
      const res = readCallArgs(src, openParen);
      expect(res.args).toHaveLength(2);
      expect(res.args[0].text).toBe("req.query.url");
      expect(res.args[1].text).toContain('{ method: "POST"');
    });
  });

  describe("LineIndex", () => {
    it("maps character offsets to line and column", () => {
      const src = "line1\nline2\nline3";
      const idx = new LineIndex(src);
      expect(idx.position(0)).toEqual({ line: 1, column: 1 });
      expect(idx.position(6)).toEqual({ line: 2, column: 1 });
      expect(idx.position(12)).toEqual({ line: 3, column: 1 });
    });
  });
});
