import { Command } from "commander";
import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import inquirer from "inquirer";
import { logInfo, resolveConfigPath } from "../output";

interface ConfigWizardAnswers {
  include: string;
  exclude: string;
  format: "json" | "sarif" | "text" | "both";
  summary: boolean;
  confidenceThreshold: string;
  autoFix: boolean;
}

export function buildInteractiveConfig(answers: ConfigWizardAnswers) {
  return {
    version: "1.0.0",
    scan: {
      include: parsePatternList(answers.include),
      exclude: parsePatternList(answers.exclude),
      maxFiles: 1000,
    },
    rules: {
      enabled: ["SOL-001", "SOL-002", "SOL-003", "VY-001", "VY-002"],
      severity: ["high", "medium", "low"],
    },
    output: {
      format: answers.format,
      summary: answers.summary,
      fixPreview: false,
      confidenceThreshold: Number(answers.confidenceThreshold),
    },
    autoFix: {
      enabled: answers.autoFix,
      safeOnly: true,
      backup: true,
    },
  };
}

export function validateConfidenceThreshold(value: string): true | string {
  if (value.trim() === "") {
    return "Enter a number between 0 and 1.";
  }
  const threshold = Number(value);
  return Number.isFinite(threshold) && threshold >= 0 && threshold <= 1
    ? true
    : "Enter a number between 0 and 1.";
}

function parsePatternList(value: string): string[] {
  return value
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

async function promptForConfig() {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Interactive setup requires a TTY. Run without --interactive for defaults.",
    );
  }

  const answers = await inquirer.prompt<ConfigWizardAnswers>([
    {
      type: "input",
      name: "include",
      message: "Files to scan (comma-separated patterns)",
      default: "**/*.sol, **/*.vy, **/*.rs",
    },
    {
      type: "input",
      name: "exclude",
      message: "Files to exclude (comma-separated patterns)",
      default: "node_modules/**, dist/**, build/**, target/**",
    },
    {
      type: "list",
      name: "format",
      message: "Default report format",
      choices: ["both", "text", "json", "sarif"],
      default: "both",
    },
    {
      type: "confirm",
      name: "summary",
      message: "Print a text summary after scans?",
      default: true,
    },
    {
      type: "input",
      name: "confidenceThreshold",
      message: "Minimum confidence threshold (0-1)",
      default: "0.7",
      validate: validateConfidenceThreshold,
    },
    {
      type: "confirm",
      name: "autoFix",
      message: "Enable automatic fixes?",
      default: false,
    },
  ]);

  return buildInteractiveConfig(answers);
}

export const initCommand = new Command("init")
  .description("Initialize GasGuard configuration in the current directory")
  .option("-f, --force", "Overwrite existing configuration")
  .option("-i, --interactive", "Choose configuration options interactively")
  .action(async (options) => {
    try {
      const configPath = path.resolve(process.cwd(), resolveConfigPath());

      // Check if config already exists
      if ((await fs.pathExists(configPath)) && !options.force) {
        logInfo(
          chalk.yellow(
            "Configuration file already exists. Use --force to overwrite.",
          ),
        );
        return;
      }

      const defaultConfig = {
        version: "1.0.0",
        scan: {
          include: ["**/*.sol", "**/*.vy", "**/*.rs"],
          exclude: ["node_modules/**", "dist/**", "build/**", "target/**"],
          maxFiles: 1000,
        },
        rules: {
          enabled: ["SOL-001", "SOL-002", "SOL-003", "VY-001", "VY-002"],
          severity: ["high", "medium", "low"],
        },
        output: {
          format: "both",
          summary: true,
          fixPreview: false,
          confidenceThreshold: 0.7,
        },
        autoFix: {
          enabled: false,
          safeOnly: true,
          backup: true,
        },
      };

      const config = options.interactive
        ? await promptForConfig()
        : defaultConfig;
      await fs.writeJson(configPath, config, { spaces: 2 });
      logInfo(
        chalk.green("✓ GasGuard configuration initialized successfully."),
      );
      logInfo(chalk.gray(`Configuration file: ${configPath}`));
    } catch (error) {
      console.error(chalk.red(`Error initializing configuration: ${error}`));
      process.exit(1);
    }
  });
