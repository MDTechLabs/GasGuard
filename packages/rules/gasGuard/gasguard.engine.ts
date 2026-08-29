import { SorobanAnalyzer } from "./src/languages/soroban.analyzer";
import { SolidityAnalyzerWrapper } from "./src/languages/solidity.analyzer";

export type ScanInput = {
  language: "soroban" | "solidity" | "vyper";
  source: string;
};

export type ScanResult = {
  issues: any[];
};

export class GasGuardEngine {
  async scan(input: ScanInput): Promise<ScanResult> {
    switch (input.language) {
      case "soroban":
        return new SorobanAnalyzer().analyze(input.source);
      case "solidity":
        return new SolidityAnalyzerWrapper().analyze(input.source);
      default:
        throw new Error(`Unsupported language: ${input.language}`);
    }
  }
}
