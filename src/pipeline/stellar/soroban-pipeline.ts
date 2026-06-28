import { PipelineExecutor } from "../../analysis/pipeline/pipeline-executor";
import { ExecutionResult } from "../../analysis/pipeline/types";
import { SorobanRuleContext } from "./types";

import {
  MissingAccessControlRule,
  WeakRoleHierarchyRule,
} from "./rules/access-control.rule";
import { MissingUpgradeGuardRule } from "./rules/upgradeability.rule";
import { UnsafeCrossContractRule } from "./rules/cross-contract.rule";
import { InefficientSymbolUsageRule } from "./rules/optimization.rule";
import { ExcessiveEventTopicsRule } from "./rules/events.rule";
import { InconsistentVisibilityRule } from "./rules/visibility.rule";

/** Build a PipelineExecutor pre-loaded with all Soroban rules. */
function createSorobanPipeline(): PipelineExecutor {
  const executor = new PipelineExecutor();

  executor.registerRules([
    // Stage 1 – independent checks (no deps)
    new MissingAccessControlRule(),
    new WeakRoleHierarchyRule(),
    new UnsafeCrossContractRule(),
    new InefficientSymbolUsageRule(),
    new ExcessiveEventTopicsRule(),
    new InconsistentVisibilityRule(),
    // Stage 2 – depends on access-control result
    new MissingUpgradeGuardRule(),
  ]);

  return executor;
}

/**
 * Analyse a single Soroban contract source file through the standardised pipeline.
 *
 * @param source   Raw contract source code
 * @param filePath Path used for violation location metadata
 * @param config   Optional rule configuration forwarded to the context
 */
export async function analyseSorobanContract(
  source: string,
  filePath: string,
  config?: Record<string, unknown>,
): Promise<ExecutionResult> {
  const executor = createSorobanPipeline();

  const context: Omit<SorobanRuleContext, "priorResults"> = {
    source,
    filePath,
    config,
  };

  return executor.execute(context);
}
