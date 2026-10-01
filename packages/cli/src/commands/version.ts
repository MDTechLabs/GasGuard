import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "fs";
import path from "path";
import { logInfo } from "../output";

export const versionCommand = new Command("version")
  .description("Show version information")
  .action(() => {
    try {
      const packagePath = path.join(__dirname, "../../package.json");
      const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));

      logInfo(chalk.blue("GasGuard CLI"));
      logInfo(chalk.gray(`Version: ${packageJson.version}`));
      logInfo(chalk.gray("Gas optimization analysis tool for smart contracts"));
    } catch (error) {
      logInfo(chalk.blue("GasGuard CLI"));
      logInfo(chalk.gray("Version: 1.0.0"));
      logInfo(chalk.gray("Gas optimization analysis tool for smart contracts"));
    }
  });
