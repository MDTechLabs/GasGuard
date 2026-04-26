import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

const showConfigCommand = new Command('show')
  .description('Show current configuration')
  .action(async () => {
    try {
      const configPath = path.join(process.cwd(), 'gasguard.config.json');
      
      if (!(await fs.pathExists(configPath))) {
        console.log(chalk.yellow('No configuration file found. Run "gasguard init" to create one.'));
        return;
      }

      const config = await fs.readJson(configPath);
      console.log(chalk.blue('Current Configuration:'));
      console.log(JSON.stringify(config, null, 2));

    } catch (error) {
      console.error(chalk.red(`Error reading configuration: ${error}`));
      process.exit(1);
    }
  });

const setConfigCommand = new Command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Configuration key (e.g., scan.maxFiles)')
  .argument('<value>', 'Configuration value')
  .action(async (key: string, value: string) => {
    try {
      const configPath = path.join(process.cwd(), 'gasguard.config.json');
      
      if (!(await fs.pathExists(configPath))) {
        console.log(chalk.yellow('No configuration file found. Run "gasguard init" to create one.'));
        return;
      }

      const config = await fs.readJson(configPath);
      
      // Parse the value (try as JSON, fallback to string)
      let parsedValue: any;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }

      // Set the nested key
      const keys = key.split('.');
      let current: any = config;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!(keys[i] in current)) {
          current[keys[i]] = {};
        }
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = parsedValue;

      await fs.writeJson(configPath, config, { spaces: 2 });
      console.log(chalk.green(`✓ Set ${key} = ${JSON.stringify(parsedValue)}`));

    } catch (error) {
      console.error(chalk.red(`Error setting configuration: ${error}`));
      process.exit(1);
    }
  });

export const configCommand = new Command('config')
  .description('Manage GasGuard configuration')
  .addCommand(showConfigCommand)
  .addCommand(setConfigCommand);
