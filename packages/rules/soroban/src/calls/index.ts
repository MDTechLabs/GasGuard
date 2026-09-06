/**
 * Soroban call-related rules (#771, #772, #773, #878, #879)
 *
 * Wraps callgraph analyzers into named rule objects
 * compatible with the GasGuard rule interface.
 */
export * from './nested-calls-rule';
export * from './cross-contract-calls-rule';
export * from './redundant-calls-rule';
export * from './recursive-contract-calls-rule';
export * from './call-depth-threshold-rule';
export * from './cross-contract-calls-in-loop-rule';
