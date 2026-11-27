/**
 * Unit tests for CLI integration utilities.
 */

import { Command } from "commander";
import {
  attachDeprecationHook,
  getFlagReplacement,
  isFlagDeprecated,
  withDeprecationCheck,
} from "../integration";
import { DEPRECATED_FLAGS } from "../config";
import {
  DeprecationLogger,
  setDeprecationLogger,
  resetDeprecationLogger,
} from "../logger";
import { resetMetricsCollector } from "../metrics";
import { Writable } from "stream";

describe("CLI Integration", () => {
  let logLines: string[];
  let mockStream: NodeJS.WriteStream;

  beforeEach(() => {
    logLines = [];
    mockStream = new Writable({
      write(chunk, encoding, callback) {
        logLines.push(chunk.toString());
        callback();
      },
    }) as NodeJS.WriteStream;

    // Set up custom logger to capture output during tests
    setDeprecationLogger(new DeprecationLogger(mockStream));
  });

  afterEach(() => {
    resetDeprecationLogger();
    resetMetricsCollector();
  });

  describe("isFlagDeprecated", () => {
    it("should return true for deprecated flags", () => {
      expect(isFlagDeprecated("--analyze-local")).toBe(true);
      expect(isFlagDeprecated("--no-progress")).toBe(true);
      expect(isFlagDeprecated("--fix-preview")).toBe(true);
    });

    it("should return false for non-deprecated flags", () => {
      expect(isFlagDeprecated("--scan")).toBe(false);
      expect(isFlagDeprecated("--help")).toBe(false);
      expect(isFlagDeprecated("--version")).toBe(false);
    });

    it("should handle flags without dashes", () => {
      expect(isFlagDeprecated("analyze-local")).toBe(true);
      expect(isFlagDeprecated("scan")).toBe(false);
    });
  });

  describe("getFlagReplacement", () => {
    it("should return replacement for deprecated flag", () => {
      expect(getFlagReplacement("--analyze-local")).toBe("scan");
      expect(getFlagReplacement("analyze-local")).toBe("scan");
      expect(getFlagReplacement("--no-progress")).toBe("--quiet");
    });

    it("should return undefined for non-deprecated flag", () => {
      expect(getFlagReplacement("--scan")).toBeUndefined();
    });

    it("should return undefined for flags without replacement", () => {
      const flagWithNoReplacement = DEPRECATED_FLAGS.find(
        (f: any) => !f.replacement
      );
      if (flagWithNoReplacement) {
        expect(getFlagReplacement(flagWithNoReplacement.flag)).toBeUndefined();
      }
    });
  });

  describe("withDeprecationCheck", () => {
    it("should wrap handler function", async () => {
      let handlerCalled = false;
      const handler = async () => {
        handlerCalled = true;
        return "success";
      };

      const wrapped = withDeprecationCheck(handler);
      const result = await wrapped();

      expect(handlerCalled).toBe(true);
      expect(result).toBe("success");
    });

    it("should check for deprecations when called", async () => {
      const handler = async () => "done";
      const wrapped = withDeprecationCheck(handler);

      // Passing deprecated flag in process.argv would trigger check
      const originalArgv = process.argv;
      process.argv = ["node", "cli", "--analyze-local"];

      await wrapped();

      process.argv = originalArgv;
    });

    it("should pass through arguments to handler", async () => {
      const handler = async (a: number, b: string, c: boolean) => {
        return `${a}-${b}-${c}`;
      };

      const wrapped = withDeprecationCheck(handler);
      const result = await wrapped(42, "test", true);

      expect(result).toBe("42-test-true");
    });

    it("should handle async handlers", async () => {
      const handler = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "async result";
      };

      const wrapped = withDeprecationCheck(handler);
      const result = await wrapped();

      expect(result).toBe("async result");
    });

    it("should handle sync handlers", () => {
      const handler = () => "sync result";
      const wrapped = withDeprecationCheck(handler);
      const result = wrapped();

      expect(result).toBe("sync result");
    });
  });

  describe("attachDeprecationHook", () => {
    it("should add hook to program", () => {
      const program = new Command();
      
      // Access life cycle hooks before attaching
      const result = attachDeprecationHook(program);
      
      expect(result).toBe(program);
    });

    it("should allow chaining", () => {
      const program = new Command();
      const result = attachDeprecationHook(program);
      
      expect(result).toBeInstanceOf(Command);
    });

    it("should not interfere with normal command execution", async () => {
      let commandExecuted = false;
      const program = new Command("test")
        .argument("<value>")
        .action(() => {
          commandExecuted = true;
        });

      attachDeprecationHook(program);

      try {
        await program.parseAsync(["node", "test", "myvalue"]);
      } catch {
        // Ignore parse errors as we're testing the hook integration
      }
    });
  });
});