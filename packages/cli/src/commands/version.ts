import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import path from 'path';

export const versionCommand = new Command('version')
  .description('Show version information')
  .action(() => {
    try {
      const packagePath = path.join(__dirname, '../../package.json');
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
      
      console.log(chalk.blue('GasGuard CLI'));
      console.log(chalk.gray(`Version: ${packageJson.version}`));
      console.log(chalk.gray('Gas optimization analysis tool for smart contracts'));
      
    } catch (error) {
      console.log(chalk.blue('GasGuard CLI'));
      console.log(chalk.gray('Version: 1.0.0'));
      console.log(chalk.gray('Gas optimization analysis tool for smart contracts'));
    }
  });
