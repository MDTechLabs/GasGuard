/**
 * Integration utilities for commander.js and CLI commands.
 * 
 * Provides hooks and helpers to integrate deprecation checking
 * into the command parsing lifecycle without breaking existing functionality.
 */

import { Command } from "commander";
import { checkDeprecatedFlags } from "./index";
import { createFlagLookup, DEPRECATED_FLAGS } from "./config";

const deprecatedFlagLookup = createFlagLookup(DEPRECATED_FLAGS);

function findDeprecatedFlag(flag: string) {
  return deprecatedFlagLookup.get(flag.replace(/^-+/, ""));
}

/**
 * Attach deprecation checking to a Commander.js program.
 * 
 * This adds a preAction hook that checks for deprecated flags
 * before any command executes.
 * 
 * @param program - Commander.js program instance
 * @returns The same program instance (for chaining)
 * 
 * @example
 * ```typescript
 * import { Command } from 'commander';
 * import { attachDeprecationHook } from './deprecation/integration';
 * 
 * const program = new Command();
 * attachDeprecationHook(program);
 * ```
 */
export function attachDeprecationHook(program: Command): Command {
  // Store the original preAction hook if it exists
  const existingHooks = (program as any)._lifeCycleHooks?.preAction || [];

  // Add our deprecation check hook
  program.hook("preAction", (thisCommand, actionCommand) => {
    // Get the raw arguments that were passed
    const argv = process.argv;
    
    // Check for deprecated flags
    checkDeprecatedFlags(argv);
  });

  return program;
}

/**
 * Create a wrapper for command action handlers that checks for deprecated flags.
 * 
 * This is useful for commands that need fine-grained control over when
 * deprecation checking occurs.
 * 
 * @param handler - Original command action handler
 * @returns Wrapped handler with deprecation checking
 * 
 * @example
 * ```typescript
 * import { withDeprecationCheck } from './deprecation/integration';
 * 
 * const scanCommand = new Command('scan')
 *   .action(withDeprecationCheck(async (options) => {
 *     // Your command logic here
 *   }));
 * ```
 */
export function withDeprecationCheck<T extends (...args: any[]) => any>(
  handler: T
): T {
  return ((...args: any[]) => {
    // Check for deprecated flags before executing handler
    checkDeprecatedFlags(process.argv);
    
    // Execute the original handler
    return handler(...args);
  }) as T;
}

/**
 * Check if a specific flag is deprecated.
 * 
 * Useful for conditional logic in commands that need to handle
 * deprecated flags differently.
 * 
 * @param flag - Flag name to check
 * @returns True if the flag is deprecated
 * 
 * @example
 * ```typescript
 * if (isFlagDeprecated('--analyze-local')) {
 *   console.log('Please use the scan command instead');
 * }
 * ```
 */
export function isFlagDeprecated(flag: string): boolean {
  return findDeprecatedFlag(flag) !== undefined;
}

/**
 * Get the replacement for a deprecated flag.
 * 
 * @param flag - Deprecated flag name
 * @returns Replacement flag/command, or undefined if no replacement
 */
export function getFlagReplacement(flag: string): string | undefined {
  const deprecated = findDeprecatedFlag(flag);
  return deprecated?.replacement;
}
