import "../commander-compat";
import { Command } from "commander";
import { runPolicyValidateCli } from "../../../../src/policy/cli";
import { getCliOptions } from "../output";

const validateCommand = new Command("validate")
  .description(
    "Validate a policy JSON file against the schema and secure defaults",
  )
  .argument("<file>", "Path to a GasGuard policy .json file")
  .option("--format <format>", "Report format: text or json", "text")
  .option("--strict", "Treat warnings as errors", false)
  .action((file: string, options: { format?: string; strict?: boolean }) => {
    const args = [file];
    if (options.format) {
      args.push("--format", options.format);
    }
    if (options.strict) {
      args.push("--strict");
    }
    const code = runPolicyValidateCli(args, { quiet: getCliOptions().quiet });
    process.exit(code);
  });

export const policyCommand = new Command("policy")
  .description("Validate GasGuard policy documents")
  .addCommand(validateCommand);
