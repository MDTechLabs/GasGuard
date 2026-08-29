import fs from "fs";
import path from "path";
import {
  GeneratorOptions,
  GenerateResult,
  TemplateKind,
  TemplateMetadata,
} from "./types";

// ── Template metadata registry ────────────────────────────────────────────────

/** Catalogue of all available Soroban contract templates. */
export const TEMPLATE_REGISTRY: Record<TemplateKind, TemplateMetadata> = {
  token: {
    kind: "token",
    title: "Fungible Token (SEP-41)",
    description:
      "A production-ready fungible token contract with minting, burning, transfers, and allowances.",
    secureDefaults: [
      "Admin-gated minting and role transfer",
      "require_auth on every state-mutating call",
      "Overflow-safe arithmetic with checked_add / checked_sub",
      "Re-initialisation guard (panics if already initialised)",
      "Self-transfer guard on transfer / transfer_from",
      "Event emission for mint, burn, transfer, and approve",
      "Allowance stored in temporary storage (auto-expiring)",
    ],
    fileName: "token.rs",
  },
  counter: {
    kind: "counter",
    title: "Counter",
    description:
      "A minimal admin-gated counter demonstrating instance storage, overflow protection, and step configuration.",
    secureDefaults: [
      "Admin-gated increment, decrement, and reset",
      "Overflow / underflow protection via checked arithmetic",
      "Configurable step size with minimum bound enforcement",
      "Re-initialisation guard",
      "Event emission on every mutation",
    ],
    fileName: "counter.rs",
  },
  nft: {
    kind: "nft",
    title: "Non-Fungible Token (NFT)",
    description:
      "An NFT contract with mint, transfer, per-token approval, and operator approval.",
    secureDefaults: [
      "Admin-gated minting",
      "Owner-only transfer and approval",
      "Per-token approval cleared on transfer",
      "Overflow-safe sequential token ID generation",
      "Existence checks on all token operations",
      "Event emission for mint, transfer, approve, and operator approval",
    ],
    fileName: "nft.rs",
  },
  multisig: {
    kind: "multisig",
    title: "Multi-Signature Wallet",
    description:
      "An M-of-N multisig wallet with proposal lifecycle: create, approve, revoke, and execute.",
    secureDefaults: [
      "Signer uniqueness enforced at initialisation",
      "Threshold bounds checked (1 ≤ threshold ≤ signers count)",
      "Proposal expiry via ledger sequence comparison",
      "Executed flag set before external invocation (re-entrancy guard)",
      "Duplicate-approval prevention",
      "require_auth on every state-mutating call",
      "Event emission for propose, approve, revoke, and execute",
    ],
    fileName: "multisig.rs",
  },
};

// ── Generator ─────────────────────────────────────────────────────────────────

/**
 * Soroban Contract Template Generator.
 *
 * Reads a raw `.rs` template from the `templates/` directory, substitutes the
 * contract name placeholder, validates the result, and writes the output file.
 */
export class SorobanTemplateGenerator {
  /** Absolute path to the directory that contains the raw `.rs` templates. */
  private readonly templatesDir: string;

  constructor(templatesDir?: string) {
    this.templatesDir =
      templatesDir ?? path.resolve(__dirname, "..", "templates");
  }

  // ─── Public API ─────────────────────────────────────────────────────

  /**
   * Generate a Soroban contract from the specified template.
   *
   * @param options - Generation options (kind, contractName, outputDir, overwrite).
   * @returns Metadata about the generated file.
   * @throws If the contract name is invalid, output already exists, or the
   *         template file cannot be read.
   */
  generate(options: GeneratorOptions): GenerateResult {
    const { kind, contractName, outputDir, overwrite = false } = options;

    this.validateContractName(contractName);

    const metadata = TEMPLATE_REGISTRY[kind];
    if (!metadata) {
      throw new Error(
        `Unknown template kind "${kind}". Available: ${Object.keys(TEMPLATE_REGISTRY).join(", ")}.`,
      );
    }

    const templatePath = path.join(this.templatesDir, metadata.fileName);
    const rawTemplate = this.readTemplate(templatePath);
    const rendered = this.renderTemplate(rawTemplate, contractName);

    const resolvedOutputDir = outputDir
      ? path.resolve(outputDir)
      : process.cwd();

    if (!fs.existsSync(resolvedOutputDir)) {
      fs.mkdirSync(resolvedOutputDir, { recursive: true });
    }

    const outputFileName = `${this.toSnakeCase(contractName)}.rs`;
    const filePath = path.join(resolvedOutputDir, outputFileName);

    if (fs.existsSync(filePath) && !overwrite) {
      throw new Error(
        `File already exists: ${filePath}. Pass overwrite: true to replace it.`,
      );
    }

    fs.writeFileSync(filePath, rendered, "utf-8");

    return { filePath, kind, contractName };
  }

  /**
   * Return the rendered template source without writing a file.
   * Useful for preview or testing.
   */
  preview(kind: TemplateKind, contractName: string): string {
    this.validateContractName(contractName);

    const metadata = TEMPLATE_REGISTRY[kind];
    if (!metadata) {
      throw new Error(`Unknown template kind "${kind}".`);
    }

    const templatePath = path.join(this.templatesDir, metadata.fileName);
    const rawTemplate = this.readTemplate(templatePath);
    return this.renderTemplate(rawTemplate, contractName);
  }

  /**
   * Return the metadata for all registered templates.
   */
  listTemplates(): TemplateMetadata[] {
    return Object.values(TEMPLATE_REGISTRY);
  }

  /**
   * Return the metadata for a single template kind.
   */
  getMetadata(kind: TemplateKind): TemplateMetadata {
    const metadata = TEMPLATE_REGISTRY[kind];
    if (!metadata) {
      throw new Error(`Unknown template kind "${kind}".`);
    }
    return metadata;
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  private readTemplate(templatePath: string): string {
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template file not found: ${templatePath}`);
    }
    return fs.readFileSync(templatePath, "utf-8");
  }

  private renderTemplate(template: string, contractName: string): string {
    return template.split("{{CONTRACT_NAME}}").join(contractName);
  }

  /**
   * Validate that the contract name is a valid Rust PascalCase identifier.
   * Soroban convention: PascalCase, letters/digits only, starts with a letter.
   */
  private validateContractName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error("Contract name must not be empty.");
    }
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
      throw new Error(
        `Invalid contract name "${name}". Must be PascalCase (e.g. "MyToken").`,
      );
    }
    if (name.length > 64) {
      throw new Error("Contract name must be 64 characters or fewer.");
    }
  }

  /** Convert PascalCase to snake_case for the output file name. */
  private toSnakeCase(name: string): string {
    return name
      .replace(/([A-Z])/g, (match, letter, offset) =>
        offset === 0 ? letter.toLowerCase() : `_${letter.toLowerCase()}`,
      )
      .replace(/__+/g, "_");
  }
}
