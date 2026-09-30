/**
 * Load a policy document from disk.
 *
 * JSON is the only accepted format. YAML is rejected so a policy file cannot
 * carry tags or ambiguous scalars. The size cap bounds memory use before parse.
 */

import * as fs from "fs";
import * as path from "path";

import { POLICY_LIMITS } from "./types";

export class PolicyLoadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PolicyLoadError";
  }
}

export interface LoadedPolicy {
  raw: unknown;
  bytesRead: number;
  filePath: string;
}

export function loadPolicyFile(filePath: string): LoadedPolicy {
  const resolved = path.resolve(filePath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new PolicyLoadError(
        "FILE_NOT_FOUND",
        `Policy file not found: ${resolved}`,
      );
    }
    throw new PolicyLoadError(
      "FILE_UNREADABLE",
      `Policy file could not be read: ${resolved}`,
    );
  }

  if (!stat.isFile()) {
    throw new PolicyLoadError(
      "NOT_A_FILE",
      `Policy path is not a file: ${resolved}`,
    );
  }

  if (stat.size === 0) {
    throw new PolicyLoadError(
      "EMPTY_FILE",
      `Policy file is empty: ${resolved}`,
    );
  }

  if (stat.size > POLICY_LIMITS.maxBytes) {
    throw new PolicyLoadError(
      "FILE_TOO_LARGE",
      `Policy file exceeds ${POLICY_LIMITS.maxBytes} bytes: ${resolved}`,
    );
  }

  const extension = path.extname(resolved).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    throw new PolicyLoadError(
      "UNSUPPORTED_FORMAT",
      "YAML policy files are not accepted. Save the policy as JSON so the document cannot use tags or ambiguous scalars.",
    );
  }
  if (extension !== ".json") {
    throw new PolicyLoadError(
      "UNSUPPORTED_FORMAT",
      `Unsupported policy extension "${extension || "(none)"}". Use a .json file.`,
    );
  }

  const text = fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, "");
  try {
    return {
      raw: JSON.parse(text) as unknown,
      bytesRead: stat.size,
      filePath: resolved,
    };
  } catch {
    throw new PolicyLoadError("INVALID_JSON", "Policy file is not valid JSON");
  }
}
