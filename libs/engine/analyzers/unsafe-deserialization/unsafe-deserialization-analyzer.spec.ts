import { Severity } from "../../core/analyzer-interface";
import {
  UnsafeDeserializationAnalyzer,
  UNSAFE_DESERIALIZATION_RULES,
  sortFindings,
} from "./unsafe-deserialization-analyzer";
import { DeserializationAnalysisMetrics } from "./telemetry";

describe("UnsafeDeserializationAnalyzer", () => {
  let analyzer: UnsafeDeserializationAnalyzer;

  beforeEach(() => {
    analyzer = new UnsafeDeserializationAnalyzer();
  });

  describe("Rule deserialization-001: Unsafe Object Deserialization", () => {
    it("flags node-serialize unserialize invocation", async () => {
      const code = `
        const serialize = require("node-serialize");
        const payload = req.body.profile;
        const obj = serialize.unserialize(payload);
      `;
      const result = await analyzer.analyze(code, "src/handlers/profile.js");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE);
      expect(result.findings[0].severity).toBe(Severity.CRITICAL);
      expect(result.findings[0].location.startLine).toBe(4);
      expect(result.findings[0].metadata?.cwe).toBe("CWE-502");
    });

    it("flags serialize-to-js deserialize call", async () => {
      const code = `
        import serializeToJs from "serialize-to-js";
        export function restoreState(raw) {
          return serializeToJs.deserialize(raw);
        }
      `;
      const result = await analyzer.analyze(code, "src/state.ts");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE);
    });

    it("flags direct unserialize call", async () => {
      const code = `
        const data = unserialize(req.query.state);
      `;
      const result = await analyzer.analyze(code, "src/utils.js");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE);
    });

    it("does not flag safe JSON.parse or safe methods", async () => {
      const code = `
        const data = JSON.parse(req.body);
        const user = parser.parse(req.query.id);
      `;
      const result = await analyzer.analyze(code, "src/safe.js");
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("Rule deserialization-002: Unsafe YAML Deserialization", () => {
    it("flags yaml.unsafeLoad", async () => {
      const code = `
        import yaml from "js-yaml";
        const doc = yaml.unsafeLoad(untrustedYamlString);
      `;
      const result = await analyzer.analyze(code, "src/config/loader.ts");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML);
      expect(result.findings[0].severity).toBe(Severity.HIGH);
    });

    it("flags js-yaml yaml.load with DEFAULT_SCHEMA", async () => {
      const code = `
        const yaml = require("js-yaml");
        const parsed = yaml.load(input, { schema: yaml.DEFAULT_SCHEMA });
      `;
      const result = await analyzer.analyze(code, "src/parser.js");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML);
    });

    it("does not flag yaml.safeLoad or load with FAILSAFE_SCHEMA", async () => {
      const code = `
        const yaml = require("js-yaml");
        const doc1 = yaml.safeLoad(input);
        const doc2 = yaml.load(input, { schema: yaml.FAILSAFE_SCHEMA });
      `;
      const result = await analyzer.analyze(code, "src/safe-yaml.js");
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("Rule deserialization-003: Eval-based Deserialization", () => {
    it("flags eval of string concatenation parsing object", async () => {
      const code = `
        const restored = eval("(" + req.body.data + ")");
      `;
      const result = await analyzer.analyze(code, "src/eval-restore.js");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.EVAL_DESERIALIZATION);
      expect(result.findings[0].severity).toBe(Severity.CRITICAL);
    });

    it("flags new Function return of payload", async () => {
      const code = `
        const parseObject = (serialized) => new Function("return " + serialized)();
      `;
      const result = await analyzer.analyze(code, "src/func-restore.js");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.EVAL_DESERIALIZATION);
    });
  });

  describe("Rule deserialization-004: Dangerous Deserialization Options", () => {
    it("flags BSON deserialize with evalFunctions enabled", async () => {
      const code = `
        import { BSON } from "bson";
        const doc = BSON.deserialize(buffer, { evalFunctions: true });
      `;
      const result = await analyzer.analyze(code, "src/bson.ts");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.DANGEROUS_DESERIALIZATION_OPTIONS);
      expect(result.findings[0].severity).toBe(Severity.HIGH);
    });
  });

  describe("Rule deserialization-005: Python Pickle & Unsafe Deserialization", () => {
    it("flags pickle.loads in Python file", async () => {
      const code = `
import pickle

def load_session(data):
    return pickle.loads(data)
      `;
      const result = await analyzer.analyze(code, "services/session.py");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.PYTHON_PICKLE);
      expect(result.findings[0].severity).toBe(Severity.CRITICAL);
    });

    it("flags python yaml.load without SafeLoader", async () => {
      const code = `
import yaml

def parse_config(content):
    return yaml.load(content)
      `;
      const result = await analyzer.analyze(code, "services/config.py");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML);
    });

    it("does not flag python yaml.load with SafeLoader", async () => {
      const code = `
import yaml

def parse_config(content):
    return yaml.load(content, Loader=yaml.SafeLoader)
      `;
      const result = await analyzer.analyze(code, "services/safe_config.py");
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("Lexical Comment & String Safety", () => {
    it("ignores deserialization in comments", async () => {
      const code = `
        // const serialize = require("node-serialize");
        // serialize.unserialize(payload);
        /*
          eval("(" + data + ")");
        */
        const safe = JSON.parse(text);
      `;
      const result = await analyzer.analyze(code, "src/commented.js");
      expect(result.findings).toHaveLength(0);
    });

    it("ignores python comments", async () => {
      const code = `
# import pickle
# pickle.loads(data)
safe_data = json.loads(data)
      `;
      const result = await analyzer.analyze(code, "src/commented.py");
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("File Skipping and Error Handling", () => {
    it("skips declaration files without findings", async () => {
      const code = `declare function unserialize(data: string): any;`;
      const result = await analyzer.analyze(code, "types/serializer.d.ts");
      expect(result.findings).toHaveLength(0);
      expect(result.filesAnalyzed).toBe(0);
    });

    it("skips unsupported file types", async () => {
      const code = `unserialize(data);`;
      const result = await analyzer.analyze(code, "README.md");
      expect(result.findings).toHaveLength(0);
      expect(result.filesAnalyzed).toBe(0);
    });

    it("skips binary content containing null bytes", async () => {
      const code = "unserialize(foo)\0binary";
      const result = await analyzer.analyze(code, "file.js");
      expect(result.findings).toHaveLength(0);
      expect(result.filesAnalyzed).toBe(0);
    });

    it("skips files exceeding maxFileBytes", async () => {
      const code = "const x = 1;\n".repeat(500);
      const result = await analyzer.analyze(code, "large.js", {
        options: {
          unsafeDeserialization: {
            maxFileBytes: 100,
          },
        },
      });
      expect(result.findings).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
    });

    it("skips files excluded by config", async () => {
      const code = `const obj = serialize.unserialize(data);`;
      const result = await analyzer.analyze(code, "src/fixtures/test.js", {
        excludePaths: ["**/fixtures/**"],
      });
      expect(result.findings).toHaveLength(0);
      expect(result.filesAnalyzed).toBe(0);
    });
  });

  describe("Configuration & Options", () => {
    it("allows disabling rules via config", async () => {
      const code = `
        const obj = serialize.unserialize(payload);
        const y = yaml.unsafeLoad(doc);
      `;
      const result = await analyzer.analyze(code, "src/test.js", {
        rules: {
          [UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE]: false,
        },
      });
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML);
    });

    it("allows overriding rule severity", async () => {
      const code = `const y = yaml.unsafeLoad(doc);`;
      const result = await analyzer.analyze(code, "src/test.js", {
        rules: {
          [UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML]: {
            enabled: true,
            severity: Severity.CRITICAL,
          },
        },
      });
      expect(result.findings[0].severity).toBe(Severity.CRITICAL);
    });

    it("supports additionalSinks configuration", async () => {
      const code = `
        const result = customDeserializer.dangerParse(input);
      `;
      const result = await analyzer.analyze(code, "src/custom.js", {
        options: {
          unsafeDeserialization: {
            additionalSinks: ["customDeserializer.dangerParse"],
          },
        },
      });
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe(UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE);
      expect(result.findings[0].metadata?.custom).toBe(true);
    });

    it("respects maxFindings limit", async () => {
      const code = `
        unserialize(a);
        unserialize(b);
        unserialize(c);
      `;
      const result = await analyzer.analyze(code, "src/multi.js", {
        maxFindings: 2,
      });
      expect(result.findings).toHaveLength(2);
    });

    it("reports telemetry metrics correctly", async () => {
      const metrics = new DeserializationAnalysisMetrics();
      const monitoredAnalyzer = new UnsafeDeserializationAnalyzer({ observer: metrics });

      await monitoredAnalyzer.analyze(`unserialize(data);`, "test.js");
      await monitoredAnalyzer.analyze("binary\0data", "bin.js");

      const snapshot = metrics.snapshot();
      expect(snapshot.filesAnalyzed).toBe(1);
      expect(snapshot.filesSkipped).toBe(1);
      expect(snapshot.skippedByReason["binary-content"]).toBe(1);
      expect(snapshot.totalFindings).toBe(1);
    });
  });

  describe("Deterministic Sorting", () => {
    it("produces identical sorted order regardless of insertion order", () => {
      const findingA = {
        ruleId: UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE,
        message: "A",
        severity: Severity.CRITICAL,
        location: { file: "b.js", startLine: 10, endLine: 10, startColumn: 5 },
      };
      const findingB = {
        ruleId: UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE,
        message: "B",
        severity: Severity.CRITICAL,
        location: { file: "a.js", startLine: 5, endLine: 5, startColumn: 1 },
      };
      const sorted1 = sortFindings([findingA, findingB]);
      const sorted2 = sortFindings([findingB, findingA]);

      expect(sorted1).toEqual(sorted2);
      expect(sorted1[0].location.file).toBe("a.js");
    });
  });
});
