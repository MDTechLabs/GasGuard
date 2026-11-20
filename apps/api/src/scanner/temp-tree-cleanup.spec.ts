import * as fs from "fs/promises";
import * as path from "path";

import { secureRemoveTree, withTempSourceTree } from "./temp-tree-cleanup";

const exists = (p: string) => fs.lstat(p).then(() => true, () => false);

describe("withTempSourceTree (#1350)", () => {
  it("removes the tree after the scan completes", async () => {
    let seen = "";
    await withTempSourceTree(async (dir) => {
      seen = dir;
      await fs.mkdir(path.join(dir, "src"));
      await fs.writeFile(path.join(dir, "src", "A.sol"), "contract A {}");
    });
    expect(await exists(seen)).toBe(false);
  });

  it("removes the tree when the scan throws", async () => {
    let seen = "";
    await expect(
      withTempSourceTree(async (dir) => {
        seen = dir;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await exists(seen)).toBe(false);
  });

  it("unlinks symlinks without following them", async () => {
    const outside = await fs.mkdtemp(path.join(require("os").tmpdir(), "gasguard-outside-"));
    await fs.writeFile(path.join(outside, "keep.txt"), "keep");
    await withTempSourceTree(async (dir) => {
      await fs.symlink(outside, path.join(dir, "link"));
    });
    expect(await exists(path.join(outside, "keep.txt"))).toBe(true);
    await secureRemoveTree(outside);
  });
});
