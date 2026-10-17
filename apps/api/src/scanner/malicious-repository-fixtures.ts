/**
 * Malicious repository fixtures (#1100).
 *
 * A small, checked-in repository fixture per malicious pattern, plus the
 * signal scan the fixtures are asserted against. Fixtures never contain real
 * credentials: every literal is an obvious placeholder, so the fixture files
 * are inert while still exercising the detection paths.
 */

import * as fs from "fs";
import * as path from "path";

export const MALICIOUS_FIXTURE_ROOT = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "test",
  "fixtures",
  "malicious-repository",
);

export type MaliciousSignalKind =
  | "lifecycle-script-network"
  | "hardcoded-credential"
  | "path-traversal-entry";

export interface FixtureFile {
  path: string;
  content: string;
}

export interface FixtureSignal {
  file: string;
  kind: MaliciousSignalKind;
}

const NETWORK_COMMAND = /\b(curl|wget|nc|ncat|Invoke-WebRequest)\b/;
const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall"] as const;
const CREDENTIAL_ASSIGNMENT =
  /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?([A-Za-z0-9_\-/+]{8,})["']?/i;
const TRAVERSAL_ENTRY = /(^|[/\\])\.\.([/\\]|$)/;

/** Read every file in the malicious-repository fixture directory. */
export function loadMaliciousFixtures(): FixtureFile[] {
  const files: FixtureFile[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push({
          path: path.relative(MALICIOUS_FIXTURE_ROOT, full).split(path.sep).join("/"),
          content: fs.readFileSync(full, "utf8"),
        });
      }
    }
  };

  walk(MALICIOUS_FIXTURE_ROOT);
  return files.sort((left, right) => (left.path < right.path ? -1 : 1));
}

/** Report the malicious signals present in the supplied files. */
export function scanFixtureSignals(files: readonly FixtureFile[]): FixtureSignal[] {
  const signals: FixtureSignal[] = [];

  for (const file of files) {
    for (const kind of signalsFor(file)) {
      signals.push({ file: file.path, kind });
    }
  }

  return signals;
}

function signalsFor(file: FixtureFile): MaliciousSignalKind[] {
  const kinds = new Set<MaliciousSignalKind>();

  if (file.path.endsWith("package.json")) {
    for (const script of LIFECYCLE_SCRIPTS) {
      const pattern = new RegExp(`"${script}"\\s*:\\s*"([^"]*)"`);
      const match = pattern.exec(file.content);
      if (match && NETWORK_COMMAND.test(match[1])) {
        kinds.add("lifecycle-script-network");
      }
    }
  }

  if (file.path.endsWith(".env") || file.path.endsWith(".txt")) {
    const match = CREDENTIAL_ASSIGNMENT.exec(file.content);
    if (match && !/example|placeholder|notreal/i.test(match[1])) {
      kinds.add("hardcoded-credential");
    }
  }

  if (file.content.split("\n").some((line) => TRAVERSAL_ENTRY.test(line.trim()))) {
    kinds.add("path-traversal-entry");
  }

  return [...kinds];
}
