import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

export const initCommand = new Command('init')
  .description('Initialize GasGuard configuration in the current directory')
  .option('-f, --force', 'Overwrite existing configuration')
  .action(async (options) => {
    try {
      const configPath = path.join(process.cwd(), 'gasguard.config.json');
      
      // Check if config already exists
      if (await fs.pathExists(configPath) && !options.force) {
        console.log(chalk.yellow('Configuration file already exists. Use --force to overwrite.'));
        return;
      }

      const defaultConfig = {
        version: '1.0.0',
        scan: {
          include: ['**/*.sol', '**/*.vy', '**/*.rs'],
          exclude: ['node_modules/**', 'dist/**', 'build/**', 'target/**'],
          maxFiles: 1000
        },
        rules: {
          enabled: ['SOL-001', 'SOL-002', 'SOL-003', 'VY-001', 'VY-002'],
          severity: ['high', 'medium', 'low']
        },
        output: {
          format: 'both',
          summary: true,
          fixPreview: false,
          confidenceThreshold: 0.7
        },
        autoFix: {
          enabled: false,
          safeOnly: true,
          backup: true
        }
      };

      await fs.writeJson(configPath, defaultConfig, { spaces: 2 });
      console.log(chalk.green('✓ GasGuard configuration initialized successfully.'));
      console.log(chalk.gray(`Configuration file: ${configPath}`));

    } catch (error) {
      console.error(chalk.red(`Error initializing configuration: ${error}`));
      process.exit(1);
    }
  });
