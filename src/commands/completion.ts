import { Command } from 'commander';
import { CliCompletionService, ShellType } from '../completion';
import { logger } from '../../utils/logger';

export function registerCompletionCommand(program: Command) {
  program
    .command('completion [shell]')
    .description('Generate shell completion script for bash, zsh, or fish')
    .action((shell: string = 'bash') => {
      try {
        if (!['bash', 'zsh', 'fish'].includes(shell)) {
          throw new Error(`Invalid shell '${shell}'. Choose from bash, zsh, fish.`);
        }

        const script = CliCompletionService.generateCompletionScript(shell as ShellType);
        console.log(script);
        logger.info({ shell }, 'Generated shell completion script');
      } catch (error: any) {
        logger.error({ err: error }, 'Failed to generate shell completion');
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    });
}