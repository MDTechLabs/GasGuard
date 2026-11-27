/**
 * Unit tests for deprecation logger.
 */

import { Writable } from "stream";
import {
  DeprecationLogger,
  getDeprecationLogger,
  resetDeprecationLogger,
  setDeprecationLogger,
} from "../logger";
import {
  DeprecatedFlag,
  DeprecationAnalysisResult,
  DeprecationSeverity,
  DeprecationUsage,
} from "../types";

const mockFlag: DeprecatedFlag = {
  flag: "--old-flag",
  replacement: "--new-flag",
  message: "Use --new-flag instead",
  severity: DeprecationSeverity.HIGH,
  deprecatedIn: "1.0.0",
  removedIn: "2.0.0",
};

const mockUsage: DeprecationUsage = {
  flag: mockFlag,
  value: undefined,
  position: 2,
  timestamp: new Date("2024-02-20T10:00:00Z"),
  correlationId: "test-123",
};

describe("DeprecationLogger", () => {
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

  describe("logUsage", () => {
    it("should log a usage event", () => {
      const logger = new DeprecationLogger(mockStream);
      logger.logUsage(mockUsage);

      expect(logLines.length).toBe(1);
      const log = JSON.parse(logLines[0]);
      expect(log.event).toBe("cli.deprecation.detected");
      expect(log.correlationId).toBe("test-123");
      expect(log.flag).toBe("--old-flag");
    });

    it("should include severity and replacement", () => {
      const logger = new DeprecationLogger(mockStream);
      logger.logUsage(mockUsage);

      const log = JSON.parse(logLines[0]);
      expect(log.severity).toBe(DeprecationSeverity.HIGH);
      expect(log.replacement).toBe("--new-flag");
    });

    it("should include position", () => {
      const logger = new DeprecationLogger(mockStream);
      logger.logUsage(mockUsage);

      const log = JSON.parse(logLines[0]);
      expect(log.position).toBe(2);
    });

    it("should include timestamp", () => {
      const logger = new DeprecationLogger(mockStream);
      logger.logUsage(mockUsage);

      const log = JSON.parse(logLines[0]);
      expect(log.timestamp).toBeDefined();
      expect(new Date(log.timestamp).getTime()).not.toBeNaN();
    });

    it("should include component name", () => {
      const logger = new DeprecationLogger(mockStream);
      logger.logUsage(mockUsage);

      const log = JSON.parse(logLines[0]);
      expect(log.component).toBe("cli.deprecation");
    });

    it("should use warn level", () => {
      const logger = new DeprecationLogger(mockStream);
      logger.logUsage(mockUsage);

      const log = JSON.parse(logLines[0]);
      expect(log.level).toBe("warn");
    });
  });

  describe("logAnalysis", () => {
    it("should log analysis summary", () => {
      const result: DeprecationAnalysisResult = {
        usages: [mockUsage],
        hasHighSeverity: true,
        metrics: {
          totalUsages: 1,
          byFlag: { "--old-flag": 1 },
          bySeverity: {
            [DeprecationSeverity.HIGH]: 1,
            [DeprecationSeverity.MEDIUM]: 0,
            [DeprecationSeverity.LOW]: 0,
          },
        },
      };

      const logger = new DeprecationLogger(mockStream);
      logger.logAnalysis(result);

      expect(logLines.length).toBe(1);
      const log = JSON.parse(logLines[0]);
      expect(log.event).toBe("cli.deprecation.analysis");
      expect(log.totalUsages).toBe(1);
    });

    it("should use error level for high severity", () => {
      const result: DeprecationAnalysisResult = {
        usages: [mockUsage],
        hasHighSeverity: true,
        metrics: {
          totalUsages: 1,
          byFlag: {},
          bySeverity: {
            [DeprecationSeverity.HIGH]: 1,
            [DeprecationSeverity.MEDIUM]: 0,
            [DeprecationSeverity.LOW]: 0,
          },
        },
      };

      const logger = new DeprecationLogger(mockStream);
      logger.logAnalysis(result);

      const log = JSON.parse(logLines[0]);
      expect(log.level).toBe("error");
    });

    it("should use warn level for non-high severity", () => {
      const lowSeverityUsage: DeprecationUsage = {
        ...mockUsage,
        flag: { ...mockFlag, severity: DeprecationSeverity.LOW },
      };
      const result: DeprecationAnalysisResult = {
        usages: [lowSeverityUsage],
        hasHighSeverity: false,
        metrics: {
          totalUsages: 1,
          byFlag: {},
          bySeverity: {
            [DeprecationSeverity.HIGH]: 0,
            [DeprecationSeverity.MEDIUM]: 0,
            [DeprecationSeverity.LOW]: 1,
          },
        },
      };

      const logger = new DeprecationLogger(mockStream);
      logger.logAnalysis(result);

      const log = JSON.parse(logLines[0]);
      expect(log.level).toBe("warn");
    });

    it("should not log when no usages", () => {
      const result: DeprecationAnalysisResult = {
        usages: [],
        hasHighSeverity: false,
        metrics: {
          totalUsages: 0,
          byFlag: {},
          bySeverity: {
            [DeprecationSeverity.HIGH]: 0,
            [DeprecationSeverity.MEDIUM]: 0,
            [DeprecationSeverity.LOW]: 0,
          },
        },
      };

      const logger = new DeprecationLogger(mockStream);
      logger.logAnalysis(result);

      expect(logLines.length).toBe(0);
    });

    it("should include high severity count", () => {
      const result: DeprecationAnalysisResult = {
        usages: [mockUsage],
        hasHighSeverity: true,
        metrics: {
          totalUsages: 3,
          byFlag: {},
          bySeverity: {
            [DeprecationSeverity.HIGH]: 2,
            [DeprecationSeverity.MEDIUM]: 1,
            [DeprecationSeverity.LOW]: 0,
          },
        },
      };

      const logger = new DeprecationLogger(mockStream);
      logger.logAnalysis(result);

      const log = JSON.parse(logLines[0]);
      expect(log.highSeverityCount).toBe(2);
    });
  });

  describe("logStart", () => {
    it("should log start event", () => {
      const logger = new DeprecationLogger(mockStream);
      logger.logStart("test-123");

      expect(logLines.length).toBe(1);
      const log = JSON.parse(logLines[0]);
      expect(log.event).toBe("cli.deprecation.check.start");
      expect(log.correlationId).toBe("test-123");
      expect(log.level).toBe("info");
    });
  });

  describe("logComplete", () => {
    it("should log completion event", () => {
      const logger = new DeprecationLogger(mockStream);
      logger.logComplete("test-123", 2, 150);

      expect(logLines.length).toBe(1);
      const log = JSON.parse(logLines[0]);
      expect(log.event).toBe("cli.deprecation.check.complete");
      expect(log.correlationId).toBe("test-123");
      expect(log.totalUsages).toBe(2);
      expect(log.message).toContain("150ms");
      expect(log.level).toBe("info");
    });
  });

  describe("error handling", () => {
    it("should not throw on write errors", () => {
      const errorStream = new Writable() as NodeJS.WriteStream;
      jest.spyOn(errorStream, "write").mockImplementation(() => {
        throw new Error("Write failed");
      });

      const logger = new DeprecationLogger(errorStream);
      
      // Should not throw
      expect(() => logger.logUsage(mockUsage)).not.toThrow();
    });
  });

  describe("global logger", () => {
    afterEach(() => {
      resetDeprecationLogger();
    });

    it("should return singleton instance", () => {
      const logger1 = getDeprecationLogger();
      const logger2 = getDeprecationLogger();
      expect(logger1).toBe(logger2);
    });

    it("should allow setting custom logger", () => {
      const customLogger = new DeprecationLogger(mockStream);
      setDeprecationLogger(customLogger);
      
      const retrieved = getDeprecationLogger();
      expect(retrieved).toBe(customLogger);
    });

    it("should reset global logger", () => {
      const logger1 = getDeprecationLogger();
      resetDeprecationLogger();
      const logger2 = getDeprecationLogger();
      
      expect(logger1).not.toBe(logger2);
    });
  });
});
