import { Request, Response, Router } from "express";
import { SimulationEngine, PolicySimulationConfig } from "@simulation/index";
import { EvmAdapter, SorobanAdapter } from "@chains/index";
import { RpcClient } from "@rpc/index";

export function createSimulationRoutes(): Router {
  const router = Router();

  // Helper to get engine based on chain
  const getEngine = (chain: string, endpoints: any[]) => {
    const rpcClient = new RpcClient(endpoints);
    const adapter =
      chain === "soroban"
        ? new SorobanAdapter(rpcClient)
        : new EvmAdapter(rpcClient);
    return new SimulationEngine(adapter);
  };

  router.post("/simulate", async (req: Request, res: Response) => {
    try {
      const { code, chain, method, params, endpoints } = req.body;
      const engine = getEngine(
        chain,
        endpoints || [{ url: "http://localhost:8545", weight: 1, priority: 1 }],
      );
      const result = await engine.simulateExecution(code, method, params || []);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/compare", async (req: Request, res: Response) => {
    try {
      const { originalCode, optimizedCode, chain, method, params, endpoints } =
        req.body;
      const engine = getEngine(
        chain,
        endpoints || [{ url: "http://localhost:8545", weight: 1, priority: 1 }],
      );
      const report = await engine.compareOptimizations(
        originalCode,
        optimizedCode,
        method,
        params || [],
      );
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Policy Simulation Endpoint
   * 
   * Simulates contract execution with policy analysis enabled.
   * This allows users to preview policy violations before actual deployment.
   * 
   * Request body:
   * - code: Contract source code
   * - chain: Blockchain network (e.g., "soroban", "evm")
   * - method: Method name to simulate
   * - params: Method parameters
   * - endpoints: RPC endpoints
   * - simulationMode: Enable policy simulation mode (default: true)
   * - policyRules: Optional array of specific policy rules to apply
   * - includePolicyDetails: Include detailed policy violation reports (default: true)
   */
  router.post("/policy-simulate", async (req: Request, res: Response) => {
    try {
      const {
        code,
        chain,
        method,
        params,
        endpoints,
        simulationMode = true,
        policyRules,
        includePolicyDetails = true,
      } = req.body;

      const engine = getEngine(
        chain,
        endpoints || [{ url: "http://localhost:8545", weight: 1, priority: 1 }],
      );

      const policyConfig: PolicySimulationConfig = {
        simulationMode,
        policyRules,
        includePolicyDetails,
      };

      const result = await engine.simulateWithPolicy(
        code,
        method,
        params || [],
        policyConfig,
      );

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
