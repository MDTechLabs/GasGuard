import { IsString, IsNumber, IsOptional, IsDate } from "class-validator";

export class GetGasEstimateDto {
  @IsString()
  chainId: string;

  @IsNumber()
  estimatedGasUnits: number;

  @IsOptional()
  @IsString()
  transactionHash?: string;

  @IsOptional()
  @IsString()
  priority?: "low" | "normal" | "high" | "critical";
}

export class GasEstimateResponseDto {
  transactionHash?: string;
  chainId: string;
  estimatedGasUnits: number;
  baseGasPrice: number;
  surgeMultiplier: number;
  dynamicGasPrice: number;
  totalEstimatedCostStroops: number;
  totalEstimatedCostXLM: number;
  priceValidityDurationMs: number;
  expiresAt: Date;
  recommendedPriority: string;
  alternativePrices: {
    low: number;
    medium: number;
    high: number;
  };
  confidence: number;
  networkLoad: number;
}

export class GasPriceHistoryDto {
  @IsString()
  chainId: string;

  @IsOptional()
  @IsNumber()
  hoursBack?: number; // default 24
}

export class NetworkMetricsDto {
  @IsString()
  chainId: string;
}
