import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import {
  parseAndSnapshot,
  renderTree,
  snapshotToJson,
  ASTSnapshot,
} from '../../../../libs/ast/index';

export const astCommand = new Command('ast')
  .description('Inspect the AST of a smart contract source file')
  .argument('<file>', 'Path to a .sol, .rs, or .vy source file')
  .option('--json', 'Output full snapshot as JSON instead of the tree view')
  .option('--compact', 'Use compact (single-line) JSON (implies --json)')
  .option('-o, --output <file>', 'Write output to a file instead of stdout')
  .option('--stats', 'Print only the stats summary (no full tree or JSON)')
  .action(async (file: string, options: {
    json?: boolean;
    compact?: boolean;
    output?: string;
    stats?: boolean;
  }) => {
    const absPath = path.resolve(file);

    if (!(await fs.pathExists(absPath))) {
      console.error(chalk.red(`✖ File not found: ${absPath}`));
      process.exit(1);
    }

    let source: string;
    try {
      source = await fs.readFile(absPath, 'utf-8');
    } catch (err) {
      console.error(chalk.red(`✖ Failed to read file: ${(err as Error).message}`));
      process.exit(1);
    }

    let snapshot: ASTSnapshot;
    try {
      snapshot = parseAndSnapshot(source, absPath);
    } catch (err) {
      console.error(chalk.red(`✖ Failed to parse AST: ${(err as Error).message}`));
      process.exit(1);
    }

    // --stats only
    if (options.stats) {
      const s = snapshot.stats;
      console.log(chalk.blue(`AST stats for ${path.basename(absPath)} [${snapshot.ast.language}]`));
      console.log(`  contracts      : ${s.contracts}`);
      console.log(`  functions      : ${s.functions}`);
      console.log(`  state variables: ${s.state_variables}`);
      console.log(`  structs        : ${s.structs}`);
      console.log(`  enums          : ${s.enums}`);
      return;
    }

    const useJson = options.json || options.compact;
    const pretty = !options.compact;

    let output: string;
    if (useJson) {
      output = snapshotToJson(snapshot, pretty);
    } else {
      output = renderTree(snapshot);
    }

    if (options.output) {
      const outPath = path.resolve(options.output);
      await fs.outputFile(outPath, output, 'utf-8');
      console.log(chalk.green(`✓ AST snapshot written to ${outPath}`));
    } else {
      // Colour the tree output; leave JSON uncoloured for piping
      if (!useJson) {
        process.stdout.write(chalk.cyan(output) + '\n');
      } else {
        process.stdout.write(output + '\n');
      }
    }
  });
