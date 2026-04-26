import { Command } from 'commander';
import chalk from 'chalk';
import { annotateFile, Annotation } from '../../../src/reporting/annotator';

export const annotateCommand = new Command('annotate')
  .description('Annotate source files with inline issue comments')
  .argument('<file>', 'Source file to annotate')
  .option('-o, --output <file>', 'Output file path (default: <file>.annotated)')
  .option('--line <n>', 'Line number for a demo annotation', '1')
  .action((file: string, options) => {
    try {
      // In a real integration the annotations would come from a scan result.
      // Here we demonstrate with a placeholder annotation.
      const annotations: Annotation[] = [
        {
          line: parseInt(options.line, 10),
          message: 'Potential gas inefficiency detected – review this pattern.',
          severity: 'warning',
        },
      ];

      const result = annotateFile(file, annotations, options.output);
      console.log(chalk.green(`✓ Annotated file written to ${result.filePath}`));
    } catch (err) {
      console.error(chalk.red(`Error annotating file: ${err}`));
      process.exit(1);
    }
  });
