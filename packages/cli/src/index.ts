#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { scanCommand } from './commands/scan';
import { initCommand } from './commands/init';
import { configCommand } from './commands/config';
import { versionCommand } from './commands/version';

const program = new Command();

// Configure CLI
program
  .name('gasguard')
  .description('GasGuard CLI - Smart contract gas optimization analysis tool')
  .version('1.0.0')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--debug', 'Enable debug mode for troubleshooting')
  .option('--no-color', 'Disable colored output');

// Global error handling
program.configureOutput({
  writeErr: (str) => process.stderr.write(chalk.red(str)),
  writeOut: (str) => process.stdout.write(str),
});

// Add commands
program.addCommand(scanCommand);
program.addCommand(initCommand);
program.addCommand(configCommand);
program.addCommand(versionCommand);

// Handle unknown commands
program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.log(chalk.yellow('See --help for a list of available commands.'));
  process.exit(1);
});

// Parse arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
