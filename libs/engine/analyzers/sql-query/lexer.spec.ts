import { LineIndex, maskComments, readCallArgs } from "./lexer";

describe("sql-query lexer", () => {
  it("masks comments while preserving offsets", () => {
    const src = "const sql = 'SELECT 1'; // test\nconst x = 2;";
    const masked = maskComments(src);
    expect(masked.length).toBe(src.length);
    expect(masked).not.toContain("// test");
    expect(masked).toContain("const sql = 'SELECT 1';");
  });

  it("extracts arguments from query calls", () => {
    const src = "db.query('SELECT * FROM users WHERE id = ' + id, [id])";
    const openParen = src.indexOf("(") + 1;
    const res = readCallArgs(src, openParen);
    expect(res.args).toHaveLength(2);
    expect(res.args[0].text).toContain("'SELECT * FROM users WHERE id = ' + id");
    expect(res.args[1].text).toBe("[id]");
  });

  it("calculates lines and columns correctly", () => {
    const idx = new LineIndex("line1\nline2");
    expect(idx.position(0)).toEqual({ line: 1, column: 1 });
    expect(idx.position(6)).toEqual({ line: 2, column: 1 });
  });
});
