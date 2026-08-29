/**
 * Soroban call-related rules (#771, #772, #773)
 *
 * Wraps the callgraph analyzer into named rule objects
 * compatible with the GasGuard rule interface.
 */
export * from './nested-calls-rule';
export * from './cross-contract-calls-rule';
export * from './redundant-calls-rule';
export * from './cross-contract-calls-in-loop-rule';
