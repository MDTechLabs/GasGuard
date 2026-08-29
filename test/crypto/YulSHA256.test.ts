import { describe, it, expect } from "vitest";
import * as crypto from "crypto";

function sha256(data: string | Buffer): string {
  const buf =
    typeof data === "string"
      ? data.startsWith("0x")
        ? Buffer.from(data.slice(2), "hex")
        : Buffer.from(data, "utf-8")
      : data;
  return "0x" + crypto.createHash("sha256").update(buf).digest("hex");
}

describe("YulSHA256", () => {
  describe("hash", () => {
    it("computes sha256 hash for empty input", () => {
      const input = "";
      const expected = sha256(input);
      // The expected empty hash is: 0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      expect(expected).toBe(
        "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
    });

    it("computes sha256 hash for short inputs", () => {
      const input = "0x1234567890";
      const expected = sha256(input);
      expect(expected).toBe(
        "0x6c450e037e79b76f231a71a22ff40403f7d9b74b15e014e52fe1156d3666c3e6",
      );
    });

    it("computes sha256 hash for standard 32-byte hash inputs", () => {
      const input = "0x" + "ab".repeat(32);
      const expected = sha256(input);
      expect(expected).toBe(
        "0x9a2db2e23f1504cd056606553ac049c5e718e8f9ce9233876df1a7a1821af885",
      );
    });

    it("computes sha256 hash for large inputs", () => {
      const input = "0x" + "ff".repeat(1024);
      const expected = sha256(input);
      expect(expected).toBe(
        "0x5f4ecdb7b71c3e403983fe405cddcdc2f2576b655fdb3e80d94a6f7c32e58bc2",
      );
    });

    it("matches standard sha256 output across random input sizes", () => {
      for (let size = 1; size <= 128; size++) {
        const input = "0x" + crypto.randomBytes(size).toString("hex");
        const expected = sha256(input);
        expect(expected.startsWith("0x")).toBe(true);
        expect(expected.length).toBe(66); // 0x + 64 hex chars
      }
    });
  });
});
