/**
 * Integration tests for deprecation system with CLI component boundaries.
 * 
 * These tests verify the deprecation system works correctly with:
 * - CLI command parsing
 * - Configuration loading
 * - Worker concurrency
 * - Persistence behavior
 */

import { Writable } from "stream";
import { Command } from "commander";

// Mock dependencies to avoid actual file system operations
jest.mock("chalk", () => {
  const identity = (value: string) => value;
  return {
    yellow: Object.assign(identity, { bold: identity }),
    red: Object.assign(identity, { bold: identity }),
    blue: Object.assign(identity, { bold: identity }),
    cyan: identity,
    green: identity,
    white: identity,
    dim: identity,
  };
});

import {
  DeprecationDetector,
  formatDeprecationSummary,
  emitDeprecationWarnings,
  shouldFailOnDeprecation,
} from "../detector";
import { checkDeprecatedFlags } from "../index";
import {
  DeprecationConfig,
  DeprecatedFlag,
  DeprecationSeverity,
  DeprecationAnalysisResult,
} from "../types";
import { createFlagLookup, loadDeprecationConfig, DEPRECATED_FLAGS } from "../config";
import { DeprecationLogger } from "../logger";
import { MetricsCollector } from "../metrics";

/**
 * Test fixtures for integration tests
 */
const testConfig: DeprecationConfig = {
  deprecatedFlags: DEPRECATED_FLAGS,
  enableWarnings: true,
  enableMetrics: true,
  failOnHighSeverity: false,
};

describe("Deprecation System Integration", () => {
  describe("Full CLI Integration Flow", () => {
    let stderrOutput: string[];
    let mockStderr: NodeJS.WriteStream;

    beforeEach(() => {
      stderrOutput = [];
      mockStderr = new Writable({
        write(chunk, encoding, callback) {
          stderrOutput.push(chunk.toString());
          callback();
        },
      }) as NodeJS.WriteStream;
    });

    it("should integrate with checkDeprecatedFlags entry point", () => {
      // Simulate CLI invocation with deprecated flag
      const argv = ["node", "gasguard", "scan", "--analyze-local", "."];
      const result = checkDeprecatedFlags(argv);

      expect(result).toBeDefined();
      expect(result.usages.length).toBe(1);
      expect(result.usages[0].flag.flag).toBe("--analyze-local");
    });

    it("should handle scan command with deprecated flags", () => {
      const argv = ["node", "gasguard", "scan", "--no-progress", "--fix-preview", "."];
      const result = checkDeprecatedFlags(argv);

      expect(result.usages.length).toBe(2);
      expect(result.metrics.totalUsages).toBe(2);
    });

    it("should handle multiple commands with mixed flags", () => {
      const argv = ["node", "gasguard", "policy", "validate", "policy.json", "--no-progress"];
      const result = checkDeprecatedFlags(argv);

      expect(result.usages.length).toBe(1);
      expect(result.usages[0].flag.flag).toBe("--no-progress");
    });

    it("should not interfere with valid commands", () => {
      const argv = ["node", "gasguard", "scan", ".", "--format", "json"];
      const result = checkDeprecatedFlags(argv);

      expect(result.usages.length).toBe(0);
      expect(result.hasHighSeverity).toBe(false);
    });
  });

  describe("Worker Concurrency Safety", () => {
    it("should be safe for concurrent worker invocations", () => {
      // Simulate multiple concurrent workers
      const detector1 = new DeprecationDetector(testConfig);
      const detector2 = new DeprecationDetector(testConfig);
      const detector3 = new DeprecationDetector(testConfig);

      const result1 = detector1.analyze(["node", "cli", "--analyze-local"]);
      const result2 = detector2.analyze(["node", "cli", "--no-progress"]);
      const result3 = detector3.analyze(["node", "cli", "--fix-preview"]);

      // Each detector should have isolated state
      expect(result1.usages.length).toBe(1);
      expect(result2.usages.length).toBe(1);
      expect(result3.usages.length).toBe(1);

      // Metrics should be independent
      expect(result1.metrics.byFlag["--analyze-local"]).toBe(1);
      expect(result2.metrics.byFlag["--no-progress"]).toBe(1);
      expect(result3.metrics.byFlag["--fix-preview"]).toBe(1);
    });

    it("should handle rapid sequential invocations", () => {
      const detector = new DeprecationDetector(testConfig);

      for (let i = 0; i < 100; i++) {
        const result = detector.analyze(["node", "cli", "--analyze-local"]);
        expect(result.usages.length).toBe(1);
        detector.clear();
      }
    });

    it("should track metrics correctly across invocations", () => {
      const collector = new MetricsCollector();

      collector.record({
        usages: [],
        hasHighSeverity: true,
        metrics: {
          totalUsages: 2,
          byFlag: { "--analyze-local": 2 },
          bySeverity: {
            [DeprecationSeverity.HIGH]: 2,
            [DeprecationSeverity.MEDIUM]: 0,
            [DeprecationSeverity.LOW]: 0,
          },
        },
      });

      collector.record({
        usages: [],
        hasHighSeverity: false,
        metrics: {
          totalUsages: 3,
          byFlag: { "--no-progress": 3 },
          bySeverity: {
            [DeprecationSeverity.HIGH]: 0,
            [DeprecationSeverity.MEDIUM]: 3,
            [DeprecationSeverity.LOW]: 0,
          },
        },
      });

      const metrics = collector.getMetrics();
      expect(metrics.totalUsages).toBe(5);
      expect(metrics.bySeverity.high).toBe(2);
      expect(metrics.bySeverity.medium).toBe(3);
      expect(metrics.invocationCount).toBe(2);
    });
  });

  describe("Configuration Loading Integration", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should respect environment variable overrides", () => {
      process.env.GASGUARD_DEPRECATION_WARNINGS = "false";
      process.env.GASGUARD_FAIL_ON_DEPRECATED = "true";

      const config = loadDeprecationConfig();

      expect(config.enableWarnings).toBe(false);
      expect(config.failOnHighSeverity).toBe(true);
    });

    it("should load all deprecated flags from config", () => {
      const config = loadDeprecationConfig();

      expect(config.deprecatedFlags.length).toBeGreaterThan(0);
      expect(config.deprecatedFlags.some(f => f.flag === "--analyze-local")).toBe(true);
      expect(config.deprecatedFlags.some(f => f.flag === "--no-progress")).toBe(true);
      expect(config.deprecatedFlags.some(f => f.flag === "--fix-preview")).toBe(true);
    });
  });

  describe("Flag Lookup Performance", () => {
    it("should create efficient lookup map", () => {
      const lookup = createFlagLookup(DEPRECATED_FLAGS);

      // Lookup should be O(1) operation
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        lookup.get("--analyze-local");
        lookup.get("--no-progress");
        lookup.get("--fix-preview");
      }
      const duration = Date.now() - start;

      // Should complete 30k lookups in under 100ms
      expect(duration).toBeLessThan(100);
    });

    it("should handle various flag formats in lookup", () => {
      const lookup = createFlagLookup(DEPRECATED_FLAGS);

      // With double dashes
      expect(lookup.get("--analyze-local")).toBeDefined();

      // Without dashes
      expect(lookup.get("analyze-local")).toBeDefined();

      // Exact match
      const flag = DEPRECATED_FLAGS[0];
      expect(lookup.get(flag.flag)).toBe(flag);
    });
  });

  describe("Failure and Boundary Cases", () => {
    it("should handle empty argv gracefully", () => {
      const detector = new DeprecationDetector(testConfig);
      const result = detector.analyze([]);

      expect(result.usages.length).toBe(0);
      expect(result.hasHighSeverity).toBe(false);
      expect(result.metrics.totalUsages).toBe(0);
    });

    it("should handle argv with only positional arguments", () => {
      const detector = new DeprecationDetector(testConfig);
      const result = detector.analyze(["node", "gasguard", "scan", "path/to/project"]);

      expect(result.usages.length).toBe(0);
    });

    it("should handle flags with = value syntax", () => {
      const detector = new DeprecationDetector(testConfig);
      const result = detector.analyze(["node", "cli", "--format=json", "--analyze-local"]);

      expect(result.usages.length).toBe(1);
      expect(result.usages[0].flag.flag).toBe("--analyze-local");
    });

    it("should detect multiple instances of same flag", () => {
      const detector = new DeprecationDetector(testConfig);
      const result = detector.analyze(["node", "cli", "--analyze-local", "--analyze-local", "."]);

      expect(result.usages.length).toBe(2);
      expect(result.metrics.byFlag["--analyze-local"]).toBe(2);
    });

    it("should handle unknown flags without crashing", () => {
      const detector = new DeprecationDetector(testConfig);
      
      expect(() => {
        detector.analyze(["node", "cli", "--unknown-flag", "-x", "--y", "value"]);
      }).not.toThrow();

      expect(() => {
        detector.analyze(["node", "cli", "--flag-with-unusual-chars"]);
      }).not.toThrow();
    });

    it("should respect failOnHighSeverity config", () => {
      const config: DeprecationConfig = {
        ...testConfig,
        failOnHighSeverity: true,
      };

      const detector = new DeprecationDetector(config);
      const result = detector.analyze(["node", "cli", "--analyze-local"]);

      expect(shouldFailOnDeprecation(result, config)).toBe(true);
    });

    it("should not fail on medium severity when configured", () => {
      const config: DeprecationConfig = {
        ...testConfig,
        failOnHighSeverity: true,
      };

      const detector = new DeprecationDetector(config);
      const result = detector.analyze(["node", "cli", "--no-progress"]);

      expect(shouldFailOnDeprecation(result, config)).toBe(false);
    });
  });

  describe("Logger Integration", () => {
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
    });

    it("should log structured JSON to stream", () => {
      const logger = new DeprecationLogger(mockStream);
      logger.logStart("test-correlation");

      expect(logLines.length).toBe(1);
      const log = JSON.parse(logLines[0]);
      expect(log.event).toBe("cli.deprecation.check.start");
      expect(log.correlationId).toBe("test-correlation");
      expect(log.component).toBe("cli.deprecation");
    });

    it("should include all required fields in log", () => {
      const logger = new DeprecationLogger(mockStream);
      logger.logUsage({
        flag: DEPRECATED_FLAGS[0],
        value: undefined,
        position: 2,
        timestamp: new Date(),
        correlationId: "test-123",
      });

      const log = JSON.parse(logLines[0]);
      expect(log.timestamp).toBeDefined();
      expect(log.level).toBe("warn");
      expect(log.event).toBe("cli.deprecation.detected");
      expect(log.flag).toBeDefined();
      expect(log.severity).toBeDefined();
      expect(log.replacement).toBeDefined();
      expect(log.position).toBeDefined();
    });

    it("should redact sensitive data from logs", () => {
      const logger = new DeprecationLogger(mockStream);
      logger.logUsage({
        flag: DEPRECATED_FLAGS[0],
        value: "secret-token",
        position: 2,
        timestamp: new Date(),
        correlationId: "test-123",
      });

      const log = JSON.parse(logLines[0]);
      // Value should be logged as part of usage tracking
      expect(log).toBeDefined();
      // But ensure we're not logging file paths or other sensitive data
      expect(log.message).not.toContain("secret");
    });
  });

  describe("Output Formatting Integration", () => {
    it("should format complete deprecation summary", () => {
      const detector = new DeprecationDetector(testConfig);
      const result = detector.analyze([
        "node", "cli", "--analyze-local", "--no-progress", "--fix-preview", "."
      ]);

      const summary = formatDeprecationSummary(result);

      expect(summary).toContain("DEPRECATION WARNINGS");
      expect(summary).toContain("Total: 3");
      expect(summary).toContain("High: 1");
      expect(summary).toContain("Medium: 1");
      expect(summary).toContain("Low: 1");
    });

    it("should include flag names in output", () => {
      const detector = new DeprecationDetector(testConfig);
      const result = detector.analyze(["node", "cli", "--analyze-local", "."]);

      const summary = formatDeprecationSummary(result);

      expect(summary).toContain("--analyze-local");
      expect(summary).toContain("scan");
    });

    it("should return empty string when no deprecations", () => {
      const detector = new DeprecationDetector(testConfig);
      const result = detector.analyze(["node", "cli", "scan", "."]);

      const summary = formatDeprecationSummary(result);

      expect(summary).toBe("");
    });

    it("should emit warnings to provided stream", () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk.toString());
          callback();
        },
      }) as NodeJS.WriteStream;

      const detector = new DeprecationDetector(testConfig);
      const result = detector.analyze(["node", "cli", "--analyze-local"]);
      emitDeprecationWarnings(result, stream);

      expect(chunks.length).toBeGreaterThan(0);
    });
  });
});